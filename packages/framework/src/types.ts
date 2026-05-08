import type { PageElement } from "@sitely/page";
import type { SchemaTypeName } from "@sitely/schemas";

/**
 * Reference to a media URL discovered during extraction.
 *
 * @remarks
 * Created by calling {@link ExtractContext.media | ctx.media()} during extraction.
 * The `type` is inferred from the URL file extension.
 */
export interface MediaRef {
	/** The resolved absolute URL of the media resource. */
	url: string;
	/** The detected media type based on file extension. */
	type: "image" | "video" | "audio" | "document" | "unknown";
}

/**
 * The extraction context provided to `validate` and `extract` functions in page definitions.
 *
 * @remarks
 * This is the primary interface that site definition authors interact with. It provides
 * DOM querying, JSON-LD access, media tracking, and metadata about the fetched page.
 *
 * @example
 * ```ts
 * const pageDef: PageDef = {
 *   provides: ["article"],
 *   examples: ["https://example.com/article/123"],
 *   validate: (ctx) => ctx.status === 200 && ctx.$("article")?.exists() === true,
 *   extract: async (ctx) => ({
 *     article: {
 *       title: ctx.$("h1")?.text() ?? "",
 *       items: ctx.$$("li.item").map(el => el.text()),
 *       ...ctx.jsonLd("Article")[0],
 *     },
 *   }),
 * };
 * ```
 */
export interface ExtractContext {
	/**
	 * Query a single element matching the CSS selector.
	 * @param selector - A CSS selector string.
	 * @returns The first matching element, or `null`.
	 */
	$(selector: string): PageElement | null;
	/**
	 * Query all matching elements.
	 * @param selector - A CSS selector string.
	 * @returns An array of matching elements.
	 */
	$$(selector: string): PageElement[];
	/**
	 * Parsed JSON-LD objects from the page, optionally filtered by `@type`.
	 * @param type - A schema.org type name to filter by (e.g. `"Article"`). If omitted, returns all.
	 * @returns An array of parsed JSON-LD objects.
	 */
	jsonLd(type?: string): Record<string, unknown>[];
	/**
	 * Mark a URL as media and get a resolved {@link MediaRef}.
	 * @param url - The media URL (absolute or relative). Returns `null` if falsy.
	 * @returns A {@link MediaRef} with resolved URL and detected type, or `null`.
	 */
	media(url: string | null | undefined): MediaRef | null;
	/** URL route params extracted from the page pattern (e.g. `:title`). */
	params: Record<string, string>;
	/** The full resolved URL of the fetched page. */
	url: string;
	/** The `<link rel="canonical">` href, if present. */
	canonical: string | null;
	/** HTTP status code of the page response. */
	status: number;
	/** HTTP response headers. */
	headers: Record<string, string>;
	/**
	 * Sandboxed fetch for supplementary requests during extraction.
	 *
	 * @remarks
	 * In live extraction, this is restricted to the site's domain and aliases
	 * and subject to rate limiting. In test contexts, calling this throws by default.
	 *
	 * @param url - The URL to fetch.
	 * @param opts - Standard fetch options.
	 * @returns A standard Response.
	 */
	fetch(url: string, opts?: RequestInit): Promise<Response>;
}

/**
 * Parameter definition for a resource.
 *
 * @example
 * ```ts
 * const params = {
 *   title: { type: "string", required: true, description: "Article title" },
 *   page: { type: "number" },
 * };
 * ```
 */
export interface ParamDef {
	/** The parameter type: `"string"` or `"number"`. */
	type: "string" | "number";
	/** Whether this parameter is required. Defaults to `false`. */
	required?: boolean;
	/** Human-readable description for API documentation. */
	description?: string;
}

/** A named resource that a site can provide. */
export interface ResourceDef {
	/** The schema.org type this resource produces (e.g. `Schema.Article`). */
	schema: SchemaTypeName;
	/** Parameters needed to resolve this resource. */
	params: Record<string, ParamDef>;
	/**
	 * Build a URL path from parameters.
	 * @param params - Resolved parameter values.
	 * @returns A URL path (e.g. `"/wiki/TypeScript"`).
	 */
	resolve: (params: Record<string, string>) => string;
	/** Cache TTL as a duration string (e.g. `"24h"`, `"5m"`, `"30s"`). */
	ttl: string;
}

/** Pagination descriptor for a page that returns lists. */
export interface PaginateDef {
	/**
	 * Return the absolute URL of the next page, or `null` if there are no more pages.
	 * @param ctx - The extraction context for the current page.
	 */
	next: (ctx: ExtractContext) => string | null;
	/**
	 * Optional: extract the total item count for response metadata.
	 * @param ctx - The extraction context for the current page.
	 */
	totalItems?: (ctx: ExtractContext) => number | null;
	/**
	 * Optional: extract the total page count for response metadata.
	 * @param ctx - The extraction context for the current page.
	 */
	totalPages?: (ctx: ExtractContext) => number | null;
}

/**
 * A page definition — a URL pattern with validation, extraction, and optional pagination.
 *
 * Pages are keyed by URL pattern (e.g. `"/wiki/:title"`) in the site definition's
 * `pages` map. Each page declares which resources it provides and how to extract them.
 */
export interface PageDef {
	/** Resource names this page provides (keys from the site's `resources` map). */
	provides: string[];
	/** Example URLs for CI testing and normalization invariant checks. */
	examples: string[];
	/**
	 * Assert invariants that distinguish the real page from a block/captcha/error page.
	 * @param ctx - The extraction context.
	 * @returns `true` if the page is valid and extraction should proceed.
	 */
	validate: (ctx: ExtractContext) => boolean;
	/**
	 * Extract structured data from the page. Return keys must match resource names in `provides`.
	 * @param ctx - The extraction context.
	 * @returns An object keyed by resource name with extracted data.
	 */
	extract: (ctx: ExtractContext) => Promise<Record<string, unknown>>;
	/** Optional pagination mechanics for multi-page resources. */
	paginate?: PaginateDef;
}

/** Per-site rate limit configuration. */
export interface RateLimitConfig {
	/** Maximum number of concurrent requests to this site. */
	maxConcurrent: number;
	/** Maximum requests per second to this site. */
	requestsPerSecond: number;
}

/** Crawl policy for background discovery of content. */
export interface CrawlConfig {
	/** Whether background crawling is enabled for this site. */
	enabled: boolean;
	/** Whether to respect the site's robots.txt. Defaults to `true`. */
	respectRobotsTxt?: boolean;
	/** Maximum link-follow depth from seed URLs. */
	maxDepth?: number;
	/**
	 * Filter function to decide which discovered links to follow.
	 * @param url - The discovered URL.
	 * @returns `true` to follow, `false` to skip.
	 */
	filterLinks?: (url: string) => boolean;
}

/**
 * A complete site definition describing how to extract structured data from a website.
 *
 * @remarks
 * Created using the {@link defineSite} helper for full type inference.
 * Contains the domain, rate limits, resource definitions (what data can be extracted),
 * and page definitions (how to extract it from specific URL patterns).
 *
 * @example
 * ```ts
 * import { Schema, defineSite } from "@sitely/framework";
 *
 * export default defineSite({
 *   name: "Example",
 *   domain: "example.com",
 *   rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
 *   resources: {
 *     article: {
 *       schema: Schema.Article,
 *       params: { id: { type: "string", required: true } },
 *       resolve: (p) => `/article/${p.id}`,
 *       ttl: "1h",
 *     },
 *   },
 *   pages: {
 *     "/article/:id": {
 *       provides: ["article"],
 *       examples: ["https://example.com/article/123"],
 *       validate: (ctx) => ctx.status === 200,
 *       extract: async (ctx) => ({
 *         article: { title: ctx.$("h1")?.text() ?? "" },
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export interface SiteDefinition {
	/** Human-readable display name (e.g. `"Wikipedia (English)"`). */
	name: string;
	/** The primary domain (e.g. `"en.wikipedia.org"`). */
	domain: string;
	/** Alternative domains that should map to this site definition. */
	aliases?: string[];
	/**
	 * Normalize URLs before cache lookup to strip tracking params, fragments, etc.
	 * @param url - The raw URL.
	 * @returns The normalized URL.
	 */
	normalizeUrl?: (url: string) => string;
	/** Rate limiting configuration for outbound requests to this site. */
	rateLimit: RateLimitConfig;
	/** Named resources this site can provide, keyed by resource name. */
	resources: Record<string, ResourceDef>;
	/** Page definitions keyed by URL pattern (e.g. `"/wiki/:title"`). */
	pages: Record<string, PageDef>;
	/** Optional crawl policy for background content discovery. */
	crawl?: CrawlConfig;
}
