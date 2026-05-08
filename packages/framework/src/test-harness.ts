import { CheerioDriver } from "@sitely/page";
import { validateExtraction } from "@sitely/schemas";
import { createExtractContext } from "./context.js";
import type { ExtractContext, SiteDefinition } from "./types.js";

/** Options for creating a test extraction context. */
export interface TestHarnessOptions {
	/** The HTML content to parse. */
	html: string;
	/** The URL this page was fetched from (used for URL params and resolution). */
	url: string;
	/** HTTP status code (defaults to 200). */
	status?: number;
	/** Override route params (otherwise extracted from URL pattern). */
	params?: Record<string, string>;
	/** Validate extracted data against declared schemas (default: true). */
	validate?: boolean;
}

/**
 * Create an {@link ExtractContext} for testing a site definition against HTML fixtures.
 *
 * @remarks
 * Internally creates a {@link CheerioDriver} and wraps {@link createExtractContext}.
 * This lets scraper authors test their extractors without making network requests.
 *
 * @param opts - Test context options including HTML and URL.
 * @returns A fully initialized ExtractContext suitable for testing.
 *
 * @example
 * ```ts
 * const ctx = createTestContext({
 *   html: "<html><body><h1>Test</h1></body></html>",
 *   url: "https://example.com/page",
 *   params: { id: "123" },
 * });
 * const title = ctx.$("h1")?.text(); // "Test"
 * ```
 */
export function createTestContext(opts: TestHarnessOptions): ExtractContext {
	const driver = new CheerioDriver({
		rawHtml: opts.html,
		url: opts.url,
		status: opts.status ?? 200,
	});

	return createExtractContext({
		driver,
		params: opts.params ?? {},
	});
}

/**
 * Match a URL against a site definition's page patterns and extract route params.
 *
 * @param site - The site definition to match against.
 * @param url - The full URL to match.
 * @returns The matched page key and extracted params, or `null` if no pattern matches.
 */
export function matchPagePattern(
	site: SiteDefinition,
	url: string,
): { pageKey: string; params: Record<string, string> } | null {
	const parsedUrl = new URL(url);
	const pathname = parsedUrl.pathname;

	for (const [pattern, _page] of Object.entries(site.pages)) {
		const params = matchPattern(pattern, pathname);
		if (params !== null) {
			// Also include query params
			for (const [key, value] of parsedUrl.searchParams) {
				if (!(key in params)) {
					params[key] = value;
				}
			}
			return { pageKey: pattern, params };
		}
	}
	return null;
}

/**
 * Match a URL pathname against a route pattern like `"/wiki/:title"` or `"/item"`.
 *
 * @remarks
 * Patterns with named segments (`:param`) require an exact segment count match.
 * Static patterns match as a prefix (e.g. `"/news"` matches `"/news?p=2"`).
 *
 * @param pattern - The route pattern (e.g. `"/wiki/:title"`).
 * @param pathname - The URL pathname to match (e.g. `"/wiki/TypeScript"`).
 * @returns Extracted params, or `null` if the pattern doesn't match.
 */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
	const patternParts = pattern.split("/").filter(Boolean);
	const pathParts = pathname.split("/").filter(Boolean);

	// If pattern has no param segments, it's a prefix match
	// e.g. "/news" should match "/news" and "/news?p=2"
	// but "/wiki/:title" requires exact segment count
	const hasParams = patternParts.some((p) => p.startsWith(":"));

	if (hasParams && patternParts.length !== pathParts.length) {
		return null;
	}
	if (!hasParams && patternParts.length > pathParts.length) {
		return null;
	}

	const params: Record<string, string> = {};

	for (let i = 0; i < patternParts.length; i++) {
		const pp = patternParts[i];
		const up = pathParts[i];

		if (pp.startsWith(":")) {
			params[pp.slice(1)] = decodeURIComponent(up);
		} else if (pp !== up) {
			return null;
		}
	}

	return params;
}

/**
 * Run a site definition's validate + extract against an HTML fixture.
 *
 * @param site - The site definition to test.
 * @param pageKey - The page pattern key (e.g. `"/wiki/:title"`).
 * @param opts - Test context options including HTML and URL.
 * @returns The extracted data object.
 * @throws If the page key is not found in the site definition or validation fails.
 *
 * @example
 * ```ts
 * const result = await testExtract(site, "/wiki/:title", {
 *   html: fixture,
 *   url: "https://en.wikipedia.org/wiki/TypeScript",
 *   params: { title: "TypeScript" },
 * });
 * console.log(result.article);
 * ```
 */
export async function testExtract(
	site: SiteDefinition,
	pageKey: string,
	opts: TestHarnessOptions,
): Promise<Record<string, unknown>> {
	const page = site.pages[pageKey];
	if (!page) {
		throw new Error(`Page pattern "${pageKey}" not found in site definition`);
	}

	const ctx = createTestContext(opts);

	const valid = page.validate(ctx);
	if (!valid) {
		throw new Error(`Validation failed for page "${pageKey}" at ${opts.url}`);
	}

	const data = await page.extract(ctx);

	if (opts.validate !== false) {
		const errors: string[] = [];
		for (const resourceName of page.provides) {
			const resource = site.resources[resourceName];
			if (!resource) continue;
			const extracted = data[resourceName];
			if (extracted === undefined) continue;
			const result = validateExtraction(resource.schema, extracted);
			if (!result.success && result.errors) {
				errors.push(
					`Validation failed for "${resourceName}" (schema: ${resource.schema}):\n  ${result.errors.join("\n  ")}`,
				);
			}
		}
		if (errors.length > 0) {
			throw new Error(`Schema validation errors:\n${errors.join("\n")}`);
		}
	}

	return data;
}
