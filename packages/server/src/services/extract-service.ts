import {
	type PageDef,
	type SiteDefinition,
	createExtractContext,
	matchPagePattern,
} from "@wapi/framework";
import { CheerioDriver } from "@wapi/page";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { fetchPage } from "../http-client.js";
import { getAllSites, getSite } from "../site-loader.js";
import type { Db } from "../types.js";
import { calculateActualCost, estimateCost, logUsage } from "./billing-service.js";
import { cacheGet, cacheGetStale, cacheSet } from "./cache-service.js";
import { SiteRateLimiter } from "./rate-limiter.js";
import { isAllowedByRobots } from "./robots-service.js";

/** Extraction status codes. */
export type ExtractionStatus =
	| "success"
	| "blocked"
	| "stale"
	| "forbidden_by_robots"
	| "error"
	| "rate_limited";

export interface ExtractResult {
	status: ExtractionStatus;
	data: Record<string, unknown> | null;
	site?: { domain: string; name: string };
	definitionType: "site" | "fallback";
	cached: boolean;
	cost: { tokensEstimated: number; tokensActual: number };
	pagination?: PaginationMeta;
}

export interface PaginationMeta {
	pagesReturned: number;
	hasMore: boolean;
	cursor: string | null;
	totalPages: number | null;
	totalItems: number | null;
}

export interface ExtractOpts {
	fresh?: boolean;
	maxPages?: number;
	cursor?: string;
}

/** In-memory request coalescing map. */
const inflightRequests = new Map<string, Promise<ExtractResult>>();

/** 30-second extraction deadline. */
const EXTRACTION_DEADLINE_MS = 30_000;

/**
 * Parse a TTL string like "24h", "5m", "30s" into seconds.
 */
function parseTtl(ttl: string): number {
	const match = ttl.match(/^(\d+)(s|m|h|d)$/);
	if (!match) return 3600; // default 1h
	const value = Number.parseInt(match[1], 10);
	switch (match[2]) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 3600;
		case "d":
			return value * 86400;
		default:
			return 3600;
	}
}

/**
 * Extract structured data from a URL. Uses a site definition if available,
 * otherwise falls back to generic extraction.
 */
export async function extractFromUrl(
	db: Db,
	redis: Redis,
	url: string,
	opts: ExtractOpts,
	auth: { consumerId: string; apiKeyId: string },
	logger: Logger,
): Promise<ExtractResult> {
	const parsed = new URL(url);
	const domain = parsed.hostname;
	const site = getSite(domain);

	if (site) {
		return extractWithSiteDefinition(db, redis, site, url, opts, auth, logger);
	}
	return extractFallback(db, redis, url, opts, auth, logger);
}

/**
 * Get a specific resource from a site by type and params.
 */
export async function getResource(
	db: Db,
	redis: Redis,
	domain: string,
	resourceName: string,
	params: Record<string, string>,
	opts: ExtractOpts,
	auth: { consumerId: string; apiKeyId: string },
	logger: Logger,
): Promise<ExtractResult> {
	const site = getSite(domain);
	if (!site) {
		return {
			status: "error",
			data: null,
			definitionType: "site",
			cached: false,
			cost: { tokensEstimated: 0, tokensActual: 0 },
		};
	}

	const resource = site.resources[resourceName];
	if (!resource) {
		return {
			status: "error",
			data: null,
			definitionType: "site",
			cached: false,
			cost: { tokensEstimated: 0, tokensActual: 0 },
		};
	}

	const path = resource.resolve(params);
	const url = `https://${site.domain}${path}`;
	return extractWithSiteDefinition(db, redis, site, url, opts, auth, logger);
}

/**
 * List all registered sites with their resource info.
 */
export function listSites(): Array<{
	domain: string;
	name: string;
	resources: Array<{ name: string; schema: string; params: Record<string, unknown> }>;
}> {
	return getAllSites().map((site) => ({
		domain: site.domain,
		name: site.name,
		resources: Object.entries(site.resources).map(([name, r]) => ({
			name,
			schema: r.schema,
			params: r.params,
		})),
	}));
}

/**
 * List all schema types across all sites.
 */
export function listSchemas(): Array<{ name: string; sites: string[] }> {
	const schemaMap = new Map<string, string[]>();
	for (const site of getAllSites()) {
		for (const resource of Object.values(site.resources)) {
			const sites = schemaMap.get(resource.schema) ?? [];
			if (!sites.includes(site.domain)) {
				sites.push(site.domain);
			}
			schemaMap.set(resource.schema, sites);
		}
	}
	return Array.from(schemaMap.entries()).map(([name, sites]) => ({ name, sites }));
}

/**
 * Find sites that provide a given schema type.
 */
export function findSitesForSchema(
	schemaType: string,
): Array<{ domain: string; name: string; resource: string }> {
	const results: Array<{ domain: string; name: string; resource: string }> = [];
	for (const site of getAllSites()) {
		for (const [name, resource] of Object.entries(site.resources)) {
			if (resource.schema === schemaType) {
				results.push({ domain: site.domain, name: site.name, resource: name });
			}
		}
	}
	return results;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function extractWithSiteDefinition(
	db: Db,
	redis: Redis,
	site: SiteDefinition,
	url: string,
	opts: ExtractOpts,
	auth: { consumerId: string; apiKeyId: string },
	logger: Logger,
): Promise<ExtractResult> {
	// Normalize URL
	const normalizedUrl = site.normalizeUrl ? site.normalizeUrl(url) : url;

	// Match page pattern
	const match = matchPagePattern(site, normalizedUrl);
	if (!match) {
		logger.warn({ url, domain: site.domain }, "URL doesn't match any page pattern");
		return extractFallback(db, redis, url, opts, auth, logger);
	}

	const page = site.pages[match.pageKey];
	const resourceName = page.provides[0] ?? "unknown";
	const resource = site.resources[resourceName];
	const ttlSeconds = resource ? parseTtl(resource.ttl) : 3600;

	// Check cache (unless fresh=true)
	if (!opts.fresh) {
		const cached = await cacheGet(db, redis, normalizedUrl);
		if (cached) {
			const cost = calculateActualCost("cachedRead", cached.dataSizeBytes);
			await logUsage(db, {
				...auth,
				operation: "cached_read",
				siteDomain: site.domain,
				resourceType: resourceName,
				tokensEstimated: cost,
				tokensActual: cost,
				dataBytes: cached.dataSizeBytes,
				status: cached.extractionStatus,
			});

			return {
				status: cached.extractionStatus as ExtractionStatus,
				data: cached.data,
				site: { domain: site.domain, name: site.name },
				definitionType: "site",
				cached: true,
				cost: { tokensEstimated: cost, tokensActual: cost },
			};
		}
	}

	// Request coalescing — if an identical request is in-flight, wait for it
	const coalescingKey = normalizedUrl;
	const inflight = inflightRequests.get(coalescingKey);
	if (inflight) {
		logger.debug({ url: normalizedUrl }, "Coalescing with in-flight request");
		return inflight;
	}

	// Execute the extraction (with coalescing tracking)
	const extractionPromise = executeExtraction(
		db,
		redis,
		site,
		page,
		match,
		normalizedUrl,
		resourceName,
		ttlSeconds,
		opts,
		auth,
		logger,
	);

	inflightRequests.set(coalescingKey, extractionPromise);
	try {
		return await extractionPromise;
	} finally {
		inflightRequests.delete(coalescingKey);
	}
}

async function executeExtraction(
	db: Db,
	redis: Redis,
	site: SiteDefinition,
	page: PageDef,
	match: { pageKey: string; params: Record<string, string> },
	normalizedUrl: string,
	resourceName: string,
	ttlSeconds: number,
	opts: ExtractOpts,
	auth: { consumerId: string; apiKeyId: string },
	logger: Logger,
): Promise<ExtractResult> {
	const estimated = estimateCost("liveScrape");
	const rateLimiter = new SiteRateLimiter(redis);

	// Check robots.txt
	const robotsAllowed = await isAllowedByRobots(db, redis, normalizedUrl, logger);
	if (!robotsAllowed) {
		return {
			status: "forbidden_by_robots",
			data: null,
			site: { domain: site.domain, name: site.name },
			definitionType: "site",
			cached: false,
			cost: { tokensEstimated: 0, tokensActual: 0 },
		};
	}

	// Per-site rate limiting
	const acquired = await rateLimiter.acquire(
		site.domain,
		site.rateLimit.maxConcurrent,
		site.rateLimit.requestsPerSecond,
	);
	if (!acquired) {
		// Try serving stale cache
		const stale = await cacheGetStale(db, normalizedUrl);
		if (stale) {
			logger.info({ url: normalizedUrl }, "Rate limited, serving stale cache");
			return {
				status: "success",
				data: { ...stale.data, _stale: true },
				site: { domain: site.domain, name: site.name },
				definitionType: "site",
				cached: true,
				cost: { tokensEstimated: estimated, tokensActual: 1 },
			};
		}

		return {
			status: "rate_limited",
			data: null,
			site: { domain: site.domain, name: site.name },
			definitionType: "site",
			cached: false,
			cost: { tokensEstimated: estimated, tokensActual: estimated },
		};
	}

	try {
		// Fetch page with deadline
		const fetchResult = await Promise.race([
			fetchPage({ url: normalizedUrl, logger }),
			rejectAfter(EXTRACTION_DEADLINE_MS, "Extraction deadline exceeded"),
		]);

		// Create PageDriver and context
		const driver = new CheerioDriver({
			rawHtml: fetchResult.html,
			url: fetchResult.url,
			status: fetchResult.status,
			headers: fetchResult.headers,
		});

		const ctx = createExtractContext({
			driver,
			params: match.params,
			fetchFn: createSandboxedFetch(site, redis, logger),
		});

		// Validate
		let valid: boolean;
		try {
			valid = page.validate(ctx);
		} catch {
			valid = false;
		}

		if (!valid) {
			const cost = calculateActualCost("liveScrape", fetchResult.sizeBytes);
			await logUsage(db, {
				...auth,
				operation: "live_scrape",
				siteDomain: site.domain,
				resourceType: resourceName,
				tokensEstimated: estimated,
				tokensActual: cost,
				dataBytes: fetchResult.sizeBytes,
				status: "blocked",
			});

			// Try stale cache as fallback
			const stale = await cacheGetStale(db, normalizedUrl);
			if (stale) {
				return {
					status: "blocked",
					data: { ...stale.data, _stale: true },
					site: { domain: site.domain, name: site.name },
					definitionType: "site",
					cached: true,
					cost: { tokensEstimated: estimated, tokensActual: cost },
				};
			}

			return {
				status: "blocked",
				data: null,
				site: { domain: site.domain, name: site.name },
				definitionType: "site",
				cached: false,
				cost: { tokensEstimated: estimated, tokensActual: cost },
			};
		}

		// Extract
		let data: Record<string, unknown>;
		try {
			data = await Promise.race([
				page.extract(ctx),
				rejectAfter(EXTRACTION_DEADLINE_MS, "Extraction deadline exceeded"),
			]);
		} catch (err) {
			logger.error({ url: normalizedUrl, err }, "Extraction failed (stale scraper?)");
			const cost = calculateActualCost("liveScrape", fetchResult.sizeBytes);
			await logUsage(db, {
				...auth,
				operation: "live_scrape",
				siteDomain: site.domain,
				resourceType: resourceName,
				tokensEstimated: estimated,
				tokensActual: cost,
				dataBytes: fetchResult.sizeBytes,
				status: "stale",
			});

			const stale = await cacheGetStale(db, normalizedUrl);
			if (stale) {
				return {
					status: "stale",
					data: { ...stale.data, _stale: true },
					site: { domain: site.domain, name: site.name },
					definitionType: "site",
					cached: true,
					cost: { tokensEstimated: estimated, tokensActual: cost },
				};
			}

			return {
				status: "stale",
				data: null,
				site: { domain: site.domain, name: site.name },
				definitionType: "site",
				cached: false,
				cost: { tokensEstimated: estimated, tokensActual: cost },
			};
		}

		// Handle pagination
		let paginationMeta: PaginationMeta | undefined;
		if (page.paginate && opts.maxPages && opts.maxPages > 1) {
			const paginated = await handlePagination(
				db,
				redis,
				site,
				page,
				match,
				ctx,
				data,
				opts,
				auth,
				logger,
			);
			data = paginated.data;
			paginationMeta = paginated.pagination;
		} else if (page.paginate) {
			// Single page but paginated resource — indicate more is available
			const nextUrl = page.paginate.next(ctx);
			paginationMeta = {
				pagesReturned: 1,
				hasMore: nextUrl !== null,
				cursor: nextUrl ? Buffer.from(nextUrl).toString("base64url") : null,
				totalPages: page.paginate.totalPages?.(ctx) ?? null,
				totalItems: page.paginate.totalItems?.(ctx) ?? null,
			};
		}

		// Cache the result
		const dataSizeBytes = Buffer.byteLength(JSON.stringify(data));
		await cacheSet(db, redis, {
			siteDomain: site.domain,
			resourceType: resourceName,
			params: match.params,
			normalizedUrl,
			data,
			extractionStatus: "success",
			ttlSeconds,
		});

		const actualCost = calculateActualCost("liveScrape", dataSizeBytes);
		await logUsage(db, {
			...auth,
			operation: "live_scrape",
			siteDomain: site.domain,
			resourceType: resourceName,
			tokensEstimated: estimated,
			tokensActual: actualCost,
			dataBytes: dataSizeBytes,
			status: "success",
		});

		return {
			status: "success",
			data,
			site: { domain: site.domain, name: site.name },
			definitionType: "site",
			cached: false,
			cost: { tokensEstimated: estimated, tokensActual: actualCost },
			pagination: paginationMeta,
		};
	} catch (err) {
		logger.error({ url: normalizedUrl, err }, "Extraction error");
		const stale = await cacheGetStale(db, normalizedUrl);
		if (stale) {
			return {
				status: "error",
				data: { ...stale.data, _stale: true },
				site: { domain: site.domain, name: site.name },
				definitionType: "site",
				cached: true,
				cost: { tokensEstimated: estimated, tokensActual: estimated },
			};
		}

		return {
			status: "error",
			data: null,
			site: { domain: site.domain, name: site.name },
			definitionType: "site",
			cached: false,
			cost: { tokensEstimated: estimated, tokensActual: estimated },
		};
	} finally {
		await rateLimiter.release(site.domain);
	}
}

async function handlePagination(
	db: Db,
	redis: Redis,
	site: SiteDefinition,
	page: PageDef,
	match: { pageKey: string; params: Record<string, string> },
	firstCtx: ReturnType<typeof createExtractContext>,
	firstData: Record<string, unknown>,
	opts: ExtractOpts,
	_auth: { consumerId: string; apiKeyId: string },
	logger: Logger,
): Promise<{ data: Record<string, unknown>; pagination: PaginationMeta }> {
	const maxPages = Math.min(opts.maxPages ?? 1, 100);
	const paginate = page.paginate!;
	let currentCtx = firstCtx;
	const allData = { ...firstData };
	let pagesReturned = 1;
	let nextUrl: string | null = paginate.next(currentCtx);
	const rateLimiter = new SiteRateLimiter(redis);

	// If we have a cursor, start from that URL instead
	if (opts.cursor) {
		try {
			nextUrl = Buffer.from(opts.cursor, "base64url").toString();
		} catch {
			nextUrl = null;
		}
	}

	while (nextUrl && pagesReturned < maxPages) {
		const robotsAllowed = await isAllowedByRobots(db, redis, nextUrl, logger);
		if (!robotsAllowed) break;

		const acquired = await rateLimiter.acquire(
			site.domain,
			site.rateLimit.maxConcurrent,
			site.rateLimit.requestsPerSecond,
		);
		if (!acquired) break;

		try {
			const fetchResult = await fetchPage({ url: nextUrl, logger });
			const driver = new CheerioDriver({
				rawHtml: fetchResult.html,
				url: fetchResult.url,
				status: fetchResult.status,
				headers: fetchResult.headers,
			});

			currentCtx = createExtractContext({ driver, params: match.params });

			const valid = (page as { validate: (ctx: unknown) => boolean }).validate(currentCtx);
			if (!valid) break;

			const pageData = await (
				page as { extract: (ctx: unknown) => Promise<Record<string, unknown>> }
			).extract(currentCtx);

			// Merge paginated data (concatenate arrays)
			for (const [key, value] of Object.entries(pageData)) {
				if (Array.isArray(value) && Array.isArray(allData[key])) {
					(allData[key] as unknown[]).push(...value);
				} else {
					allData[key] = value;
				}
			}

			pagesReturned++;
			nextUrl = paginate.next(currentCtx);
		} finally {
			await rateLimiter.release(site.domain);
		}
	}

	return {
		data: allData,
		pagination: {
			pagesReturned,
			hasMore: nextUrl !== null,
			cursor: nextUrl ? Buffer.from(nextUrl).toString("base64url") : null,
			totalPages: paginate.totalPages?.(currentCtx) ?? null,
			totalItems: paginate.totalItems?.(currentCtx) ?? null,
		},
	};
}

/**
 * Generic fallback extractor for URLs with no site definition.
 * Extracts JSON-LD, OpenGraph, Twitter Cards, meta tags, microdata, feeds.
 */
async function extractFallback(
	db: Db,
	redis: Redis,
	url: string,
	opts: ExtractOpts,
	auth: { consumerId: string; apiKeyId: string },
	logger: Logger,
): Promise<ExtractResult> {
	const estimated = estimateCost("fallbackExtraction");

	// Check cache first
	if (!opts.fresh) {
		const cached = await cacheGet(db, redis, url);
		if (cached) {
			const cost = calculateActualCost("cachedRead", cached.dataSizeBytes);
			await logUsage(db, {
				...auth,
				operation: "cached_fallback",
				siteDomain: new URL(url).hostname,
				tokensEstimated: cost,
				tokensActual: cost,
				dataBytes: cached.dataSizeBytes,
				status: "success",
			});

			return {
				status: "success",
				data: cached.data,
				definitionType: "fallback",
				cached: true,
				cost: { tokensEstimated: cost, tokensActual: cost },
			};
		}
	}

	try {
		const fetchResult = await fetchPage({ url, logger });
		const driver = new CheerioDriver({
			rawHtml: fetchResult.html,
			url: fetchResult.url,
			status: fetchResult.status,
			headers: fetchResult.headers,
		});

		const ctx = createExtractContext({ driver, params: {} });

		// Extract all available structured data
		const data: Record<string, unknown> = {};

		// JSON-LD
		const jsonLd = ctx.jsonLd();
		if (jsonLd.length > 0) {
			data.jsonLd = jsonLd;
		}

		// OpenGraph
		const og: Record<string, string> = {};
		for (const el of driver.$$("meta[property^='og:']")) {
			const prop = el.attr("property")?.replace("og:", "");
			const content = el.attr("content");
			if (prop && content) og[prop] = content;
		}
		if (Object.keys(og).length > 0) data.openGraph = og;

		// Twitter Cards
		const twitter: Record<string, string> = {};
		for (const el of driver.$$("meta[name^='twitter:']")) {
			const name = el.attr("name")?.replace("twitter:", "");
			const content = el.attr("content");
			if (name && content) twitter[name] = content;
		}
		if (Object.keys(twitter).length > 0) data.twitterCard = twitter;

		// Standard meta tags
		const meta: Record<string, string> = {};
		const title = driver.title();
		if (title) meta.title = title;

		const descEl = driver.$('meta[name="description"]');
		if (descEl) meta.description = descEl.attr("content") ?? "";
		const authorEl = driver.$('meta[name="author"]');
		if (authorEl) meta.author = authorEl.attr("content") ?? "";
		const keywordsEl = driver.$('meta[name="keywords"]');
		if (keywordsEl) meta.keywords = keywordsEl.attr("content") ?? "";

		if (Object.keys(meta).length > 0) data.meta = meta;

		// Canonical URL
		const canonical = ctx.canonical;
		if (canonical) data.canonicalUrl = canonical;

		// Feed links
		const feeds: Array<{ type: string; href: string; title?: string }> = [];
		for (const el of driver.$$('link[rel="alternate"][type]')) {
			const type = el.attr("type") ?? "";
			if (type.includes("rss") || type.includes("atom")) {
				feeds.push({
					type,
					href: el.attr("href") ?? "",
					title: el.attr("title") ?? undefined,
				});
			}
		}
		if (feeds.length > 0) data.feeds = feeds;

		// Cache the fallback result (1h TTL)
		const dataSizeBytes = Buffer.byteLength(JSON.stringify(data));
		await cacheSet(db, redis, {
			siteDomain: new URL(url).hostname,
			resourceType: "_fallback",
			params: {},
			normalizedUrl: url,
			data,
			extractionStatus: "success",
			ttlSeconds: 3600,
		});

		const actualCost = calculateActualCost("fallbackExtraction", dataSizeBytes);
		await logUsage(db, {
			...auth,
			operation: "fallback_extraction",
			siteDomain: new URL(url).hostname,
			tokensEstimated: estimated,
			tokensActual: actualCost,
			dataBytes: dataSizeBytes,
			status: "success",
		});

		return {
			status: "success",
			data,
			definitionType: "fallback",
			cached: false,
			cost: { tokensEstimated: estimated, tokensActual: actualCost },
		};
	} catch (err) {
		logger.error({ url, err }, "Fallback extraction failed");
		return {
			status: "error",
			data: null,
			definitionType: "fallback",
			cached: false,
			cost: { tokensEstimated: estimated, tokensActual: estimated },
		};
	}
}

/**
 * Create a sandboxed fetch function for use within extraction contexts.
 * Restricts requests to the site's domain and aliases.
 */
function createSandboxedFetch(
	site: SiteDefinition,
	redis: Redis,
	_logger: Logger,
): (url: string, opts?: RequestInit) => Promise<Response> {
	const allowedDomains = new Set([site.domain, ...(site.aliases ?? [])]);
	const rateLimiter = new SiteRateLimiter(redis);

	return async (url: string, opts?: RequestInit): Promise<Response> => {
		const parsed = new URL(url, `https://${site.domain}`);
		if (!allowedDomains.has(parsed.hostname)) {
			throw new Error(
				`ctx.fetch() domain "${parsed.hostname}" not allowed for site ${site.domain}`,
			);
		}

		const acquired = await rateLimiter.acquire(
			site.domain,
			site.rateLimit.maxConcurrent,
			site.rateLimit.requestsPerSecond,
		);
		if (!acquired) {
			throw new Error(`Rate limited for ${site.domain}`);
		}

		try {
			return await fetch(parsed.toString(), {
				...opts,
				signal: opts?.signal ?? AbortSignal.timeout(15_000),
			});
		} finally {
			await rateLimiter.release(site.domain);
		}
	};
}

function rejectAfter(ms: number, message: string): Promise<never> {
	return new Promise((_, reject) => {
		setTimeout(() => reject(new Error(message)), ms);
	});
}
