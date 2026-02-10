import { createCheerioDriver } from "@wapi/page";
import { createExtractContext, parseJsonLd, getCanonicalFromHtml } from "@wapi/framework";
import type { SiteDefinition } from "@wapi/framework";
import { fetchPage } from "../http-client.js";
import { getCached, setCached, parseTtl } from "./cache-service.js";
import { deductEstimated, reconcile } from "./billing-service.js";

// ── Site Definition Registry ───────────────────────────────────────

const siteRegistry = new Map<string, SiteDefinition>();

/** Register a site definition (called at startup / hot-reload). */
export function registerSite(site: SiteDefinition): void {
	siteRegistry.set(site.domain, site);
	if (site.aliases) {
		for (const alias of site.aliases) {
			siteRegistry.set(alias, site);
		}
	}
}

/** Get all registered sites. */
export function listSites(): SiteDefinition[] {
	// Deduplicate (aliases point to same object)
	return [...new Set(siteRegistry.values())];
}

/** Find a site definition by domain. */
export function findSite(domain: string): SiteDefinition | null {
	return siteRegistry.get(domain) ?? null;
}

// ── Generic Fallback Extractor ─────────────────────────────────────

function extractFallback(html: string, url: string): Record<string, unknown> {
	const driver = createCheerioDriver({ html, url, status: 200 });

	// JSON-LD
	const jsonLd = parseJsonLd(html);

	// OpenGraph
	const og: Record<string, string> = {};
	for (const el of driver.$$('meta[property^="og:"]')) {
		const prop = el.attr("property");
		const content = el.attr("content");
		if (prop && content) {
			og[prop.replace("og:", "")] = content;
		}
	}

	// Twitter Cards
	const twitter: Record<string, string> = {};
	for (const el of driver.$$('meta[name^="twitter:"]')) {
		const name = el.attr("name");
		const content = el.attr("content");
		if (name && content) {
			twitter[name.replace("twitter:", "")] = content;
		}
	}

	// Standard meta tags
	const meta: Record<string, string> = {};
	const titleEl = driver.$("title");
	if (titleEl) meta["title"] = titleEl.text();

	for (const name of ["description", "author", "keywords"]) {
		const el = driver.$(`meta[name="${name}"]`);
		const content = el?.attr("content");
		if (content) meta[name] = content;
	}

	// Canonical URL
	const canonical = getCanonicalFromHtml(html);

	// Feeds
	const feeds: Array<{ type: string; href: string; title?: string }> = [];
	for (const el of driver.$$('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]')) {
		const href = el.attr("href");
		const type = el.attr("type");
		if (href && type) {
			feeds.push({ type, href, title: el.attr("title") ?? undefined });
		}
	}

	return {
		definitionType: "fallback",
		jsonLd,
		openGraph: Object.keys(og).length > 0 ? og : undefined,
		twitterCard: Object.keys(twitter).length > 0 ? twitter : undefined,
		meta,
		canonical,
		feeds: feeds.length > 0 ? feeds : undefined,
	};
}

// ── URL Pattern Matching ───────────────────────────────────────────

/** Match a URL path against a pattern like "/wiki/:title" and extract params. */
function matchPattern(
	pattern: string,
	urlPath: string,
): Record<string, string> | null {
	const patternParts = pattern.split("/");
	const pathParts = urlPath.split("?")[0]!.split("/");

	// For query-based patterns like "/item" with ?id=..., match differently
	if (pattern === "/item" || pattern === "/news") {
		if (urlPath.startsWith(pattern)) {
			const url = new URL(`https://dummy${urlPath}`);
			const params: Record<string, string> = {};
			url.searchParams.forEach((value, key) => {
				params[key] = value;
			});
			return params;
		}
		return null;
	}

	if (patternParts.length !== pathParts.length) return null;

	const params: Record<string, string> = {};
	for (let i = 0; i < patternParts.length; i++) {
		const pp = patternParts[i]!;
		const up = pathParts[i]!;
		if (pp.startsWith(":")) {
			params[pp.slice(1)] = decodeURIComponent(up);
		} else if (pp !== up) {
			return null;
		}
	}
	return params;
}

// ── Main Extract Function ──────────────────────────────────────────

export interface ExtractResult {
	status: "success" | "blocked" | "stale" | "forbidden_by_robots" | "error";
	data: Record<string, unknown>;
	definitionType: "site" | "fallback";
	cost: { tokens: number };
}

export async function extractFromUrl(
	url: string,
	consumerId: string | null,
): Promise<ExtractResult> {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return {
			status: "error",
			data: { error: "Invalid URL" },
			definitionType: "fallback",
			cost: { tokens: 0 },
		};
	}

	const domain = parsedUrl.hostname;
	const site = findSite(domain);

	// Check cache first
	const normalizedUrl = site ? site.normalizeUrl(url) : url;
	const cached = getCached(normalizedUrl);
	if (cached) {
		// Charge cached read rate
		if (consumerId) {
			const estimated = deductEstimated(consumerId, "cachedRead", cached.sizeBytes);
			if (estimated === null) {
				return {
					status: "error",
					data: { error: "Insufficient token balance" },
					definitionType: site ? "site" : "fallback",
					cost: { tokens: 0 },
				};
			}
		}
		return {
			status: cached.status as ExtractResult["status"],
			data: cached.data as Record<string, unknown>,
			definitionType: site ? "site" : "fallback",
			cost: { tokens: 1 },
		};
	}

	// Determine operation type for billing
	const opType = site ? "liveScrapeStatic" : "fallbackExtraction";

	// Deduct estimated tokens
	let estimatedDeduction = 0;
	if (consumerId) {
		const est = deductEstimated(consumerId, opType);
		if (est === null) {
			return {
				status: "error",
				data: { error: "Insufficient token balance" },
				definitionType: site ? "site" : "fallback",
				cost: { tokens: 0 },
			};
		}
		estimatedDeduction = est;
	}

	// Fetch the page
	let fetchResult;
	try {
		fetchResult = await fetchPage({ url });
	} catch (err) {
		return {
			status: "error",
			data: { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` },
			definitionType: site ? "site" : "fallback",
			cost: { tokens: estimatedDeduction },
		};
	}

	// If no site definition, use fallback
	if (!site) {
		const fallbackData = extractFallback(fetchResult.html, fetchResult.url);
		const sizeBytes = new TextEncoder().encode(JSON.stringify(fallbackData)).byteLength;

		// Reconcile billing
		if (consumerId) {
			reconcile(consumerId, opType, estimatedDeduction, sizeBytes);
		}

		// Cache it
		setCached(normalizedUrl, {
			data: fallbackData,
			normalizedUrl,
			siteDomain: domain,
			resourceType: "fallback",
			status: "success",
			sizeBytes,
			ttlMs: parseTtl("1h"),
		});

		return {
			status: "success",
			data: fallbackData,
			definitionType: "fallback",
			cost: { tokens: estimatedDeduction },
		};
	}

	// Site-specific extraction
	const urlPath = parsedUrl.pathname + parsedUrl.search;

	// Find matching page
	let matchedPagePattern: string | null = null;
	let matchedParams: Record<string, string> = {};

	for (const pattern of Object.keys(site.pages)) {
		const params = matchPattern(pattern, urlPath);
		if (params) {
			matchedPagePattern = pattern;
			matchedParams = params;
			break;
		}
	}

	if (!matchedPagePattern) {
		// No page matches — use fallback for this site
		const fallbackData = extractFallback(fetchResult.html, fetchResult.url);
		const sizeBytes = new TextEncoder().encode(JSON.stringify(fallbackData)).byteLength;
		if (consumerId) {
			reconcile(consumerId, opType, estimatedDeduction, sizeBytes);
		}
		return {
			status: "success",
			data: fallbackData,
			definitionType: "fallback",
			cost: { tokens: estimatedDeduction },
		};
	}

	const pageDef = site.pages[matchedPagePattern]!;

	// Create driver and context
	const driver = createCheerioDriver({
		html: fetchResult.html,
		url: fetchResult.url,
		status: fetchResult.status,
		headers: fetchResult.headers,
	});

	const ctx = createExtractContext({
		driver,
		params: matchedParams,
		rawHtml: fetchResult.html,
	});

	// Validate
	let isValid: boolean;
	try {
		isValid = pageDef.validate(ctx);
	} catch {
		isValid = false;
	}

	if (!isValid) {
		if (consumerId) {
			reconcile(consumerId, opType, estimatedDeduction, fetchResult.sizeBytes);
		}
		return {
			status: "blocked",
			data: { error: "Page validation failed — may be blocked or rate-limited" },
			definitionType: "site",
			cost: { tokens: estimatedDeduction },
		};
	}

	// Extract
	let extractedData: Record<string, unknown>;
	try {
		extractedData = await pageDef.extract(ctx);
	} catch (err) {
		if (consumerId) {
			reconcile(consumerId, opType, estimatedDeduction, fetchResult.sizeBytes);
		}
		return {
			status: "stale",
			data: {
				error: `Extraction failed — scraper may be outdated: ${err instanceof Error ? err.message : String(err)}`,
			},
			definitionType: "site",
			cost: { tokens: estimatedDeduction },
		};
	}

	const dataSizeBytes = new TextEncoder().encode(JSON.stringify(extractedData)).byteLength;

	// Reconcile billing
	if (consumerId) {
		reconcile(consumerId, opType, estimatedDeduction, dataSizeBytes);
	}

	// Cache the result
	const ttl = Object.values(site.resources).find((r) =>
		pageDef.provides.includes(
			Object.entries(site.resources).find(([, v]) => v === r)?.[0] ?? "",
		),
	)?.ttl;
	setCached(normalizedUrl, {
		data: extractedData,
		normalizedUrl,
		siteDomain: domain,
		resourceType: pageDef.provides[0] ?? "unknown",
		status: "success",
		sizeBytes: dataSizeBytes,
		ttlMs: parseTtl(ttl ?? "1h"),
	});

	return {
		status: "success",
		data: extractedData,
		definitionType: "site",
		cost: { tokens: estimatedDeduction },
	};
}
