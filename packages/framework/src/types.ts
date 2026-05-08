import type { PageElement } from "@sitely/page";
import type { StandardSchemaV1 } from "./standard-schema.js";

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
	/** Active locale for this extraction, or `null` if the site has no locales declared. */
	locale: string | null;
	/**
	 * Sandboxed fetch for supplementary requests during extraction.
	 *
	 * @remarks
	 * In live extraction, this is restricted to the site's declared origins
	 * and subject to rate limiting. In test contexts, calling this throws by default.
	 *
	 * @param url - The URL to fetch.
	 * @param opts - Standard fetch options.
	 * @returns A standard Response.
	 */
	fetch(url: string, opts?: RequestInit): Promise<Response>;
}

/** Parameter definition for a resource. */
export interface ParamDef {
	/** The parameter type: `"string"` or `"number"`. */
	type: "string" | "number";
	/** Whether this parameter is required. Defaults to `false`. */
	required?: boolean;
	/** Human-readable description for API documentation. */
	description?: string;
}

/**
 * TTL bounds for a resource.
 *
 * Per atlas spec §5: `default` is the cache TTL applied unless a client overrides;
 * client overrides are clamped to `[min, max]`. Sanity bounds enforced at build:
 * `min` >= 1s, `max` <= 30d, `min` <= `default` <= `max`.
 *
 * Duration string format: `<digits><unit>` where unit is `s|m|h|d` (e.g. `"30s"`, `"5m"`, `"1h"`, `"7d"`).
 */
export interface ResourceTTL {
	default: string;
	min: string;
	max: string;
}

/** A named resource that a site can provide. */
export interface ResourceDef {
	/**
	 * String reference into the site's top-level `schemas` map.
	 *
	 * Use the schema name as a string (e.g. `"Article"`) and add the corresponding
	 * Standard Schema validator to the site's `schemas` map.
	 */
	schema: string;
	/** Parameters needed to resolve this resource. */
	params: Record<string, ParamDef>;
	/**
	 * Build a URL path from parameters.
	 * @param params - Resolved parameter values.
	 * @returns A URL path (e.g. `"/wiki/TypeScript"`).
	 */
	resolve: (params: Record<string, string>) => string;
	/** TTL bounds: default + min/max for client overrides. */
	ttl: ResourceTTL;
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

/** A page definition — a URL pattern with validation, extraction, and optional pagination. */
export interface PageDef {
	/** Resource names this page provides (keys from the site's `resources` map). */
	provides: string[];
	/** Example URLs for CI testing and normalization invariant checks. */
	examples: string[];
	/**
	 * Optional explicit fixture file paths (relative to the package root, e.g. `"fixtures/en/typescript.html"`).
	 *
	 * If omitted, fixtures are auto-discovered from the legacy `fixtures.json` manifest.
	 */
	fixtures?: string[];
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
	/** Maximum number of concurrent requests. */
	maxConcurrent: number;
	/** Maximum requests per second. */
	requestsPerSecond: number;
	/**
	 * Whether the limit is per-origin or shared across the whole site.
	 *
	 * Default: `"origin"`. Use `"site"` when locale-in-host servers all sit behind
	 * one CDN that shouldn't be hammered in aggregate.
	 */
	scope?: "origin" | "site";
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
 * Site identity metadata — replaces the v1 top-level `name` and `domain`.
 *
 * `id` is the canonical scoped identifier (e.g. `"wikipedia"`); resource IDs
 * are scoped as `<id>:<resource>`. `displayName` is the human-readable name
 * for the directory.
 */
export interface SiteIdentity {
	/** Canonical site identifier, used as the resource-ID scope (e.g. `"wikipedia"`). */
	id: string;
	/** Human-readable display name (e.g. `"Wikipedia"`). */
	displayName: string;
	/** Optional homepage URL for directory rendering. */
	homepage?: string;
}

/**
 * A declared origin (hostname) for the site.
 *
 * If `templated: true`, the hostname contains `{locale}` substitutions
 * resolved against `site.locales.values`. Otherwise the hostname is literal.
 */
export interface Origin {
	/** Hostname, optionally with `{locale}` template segments. */
	hostname: string;
	/** Whether `{locale}` substitutions apply. Default: `false`. */
	templated?: boolean;
}

/**
 * Locale model for multi-language sites.
 *
 * Per atlas spec §3:
 * - `source: "host"` — locale appears in the hostname (e.g. `en.wikipedia.org`); N origins.
 * - `source: "path"` — locale appears in the URL path; 1 origin shared across locales.
 * - `source: "query"` — locale appears as a query param; 1 origin shared across locales.
 *
 * Per atlas addendum-2 §3: assumes a uniform host template across all locales.
 * Mixed-host sites should be split into multiple packages.
 */
export interface LocaleConfig {
	source: "host" | "path" | "query";
	values: string[];
	default: string;
}

/**
 * Capability declarations — what the site's extractor is allowed to do at test time.
 *
 * Per atlas spec §8: the test harness enforces these via `worker_threads` with a
 * stubbed fetch + module deny-list. Capability violations during `<sitely> test`
 * are test failures.
 *
 * Defaults if omitted: `{network: {egress: "site-only"}, filesystem: "none",
 * process: "none", timers: {maxWallMs: 30000}, memory: {maxMb: 256}}`.
 */
export interface CapabilityConfig {
	network?: { egress: "site-only" | "any" | "none" };
	filesystem?: "none" | "read-temp" | "read-write-temp";
	process?: "none";
	timers?: { maxWallMs: number };
	memory?: { maxMb: number };
}

/**
 * Framework version compatibility range for the runner to consume.
 *
 * Per atlas addendum-2 §6: missing range = caret-compatible with the framework version
 * listed in the package's `dependencies`. Both fields optional.
 */
export interface FrameworkRange {
	minVersion?: string;
	maxVersion?: string;
}

/**
 * Site family declaration — only used for true family packages (e.g. Stack Exchange network).
 *
 * Per atlas spec §4: family packages require structural identity across declared origins.
 * Per-origin metadata overrides (rateLimit, display) are allowed; redefining
 * `validate`, `extract`, `pages`, `resources`, or `schema` is not.
 */
export interface FamilyConfig {
	origins: Array<{
		hostname: string;
		display?: string;
		rateLimit?: Partial<RateLimitConfig>;
	}>;
	/** Path to a fixture used to assert structural identity across origins. */
	structuralIdentityCheck: string;
}

/**
 * A complete site definition (DSL v2 — atlas spec §0/§1/§3/§8).
 *
 * Created using the {@link defineSite} helper for full type inference.
 */
export interface SiteDefinition {
	/** Site identity — id, display name, homepage. */
	site: SiteIdentity;
	/** Declared origins. May contain `{locale}` templates if `locales` is also declared. */
	origins: Origin[];
	/** Optional locale model. Omit for single-locale sites. */
	locales?: LocaleConfig;
	/**
	 * Top-level Standard Schema validators, referenced by name from `resources[].schema`.
	 *
	 * Use Zod (default), Valibot, ArkType, or any Standard Schema-v1-compliant validator.
	 * Each schema is emitted as JSON Schema at build time for introspection.
	 */
	schemas: Record<string, StandardSchemaV1>;
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
	/** Optional capability declarations. Defaults applied if missing. */
	capabilities?: CapabilityConfig;
	/** Optional framework version compatibility range for the runner. */
	framework?: FrameworkRange;
	/** Optional family declaration. Most sites should not use this; per-origin packages are the default. */
	family?: FamilyConfig;
	/** Optional crawl policy for background content discovery. */
	crawl?: CrawlConfig;
}
