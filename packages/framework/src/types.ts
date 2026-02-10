import type { PageElement } from "@wapi/page";

// ── Media ──────────────────────────────────────────────────────────

export interface MediaRef {
	url: string;
	type: "image" | "video" | "audio" | "document" | "unknown";
}

// ── Extraction Context ─────────────────────────────────────────────

/** The context object passed to validate/extract/paginate functions. */
export interface ExtractContext {
	/** Query a single element. */
	$(selector: string): PageElement | null;
	/** Query all matching elements. */
	$$(selector: string): PageElement[];
	/** Parsed JSON-LD objects, optionally filtered by @type. */
	jsonLd(type?: string): Record<string, unknown>[];
	/** Mark a URL as media for the pipeline. Returns a MediaRef or null if url is falsy. */
	media(url: string | null | undefined): MediaRef | null;
	/** URL pattern params (e.g. :title). */
	params: Record<string, string>;
	/** The full resolved URL. */
	url: string;
	/** The <link rel="canonical"> href, if present. */
	canonical: string | null;
	/** HTTP status code. */
	status: number;
	/** Response headers. */
	headers: Record<string, string>;
	/** Sandboxed fetch for supplementary requests. */
	fetch(url: string, init?: RequestInit): Promise<Response>;
}

// ── Pagination ─────────────────────────────────────────────────────

export interface PaginateDef {
	/** Return the absolute URL of the next page, or null if no more pages. */
	next: (ctx: ExtractContext) => string | null;
	totalItems?: (ctx: ExtractContext) => number | null;
	totalPages?: (ctx: ExtractContext) => number | null;
}

// ── Parameter Definition ───────────────────────────────────────────

export interface ParamDef {
	type: "string" | "number";
	required: boolean;
	description: string;
}

// ── Resource Definition ────────────────────────────────────────────

export interface ResourceDef {
	schema: string;
	params: Record<string, ParamDef>;
	resolve: (params: Record<string, string>) => string;
	ttl: string;
}

// ── Page Definition ────────────────────────────────────────────────

export interface PageDef {
	provides: readonly string[];
	examples: readonly string[];
	validate: (ctx: ExtractContext) => boolean;
	extract: (ctx: ExtractContext) => Promise<Record<string, unknown>>;
	paginate?: PaginateDef;
}

// ── Rate Limit ─────────────────────────────────────────────────────

export interface RateLimitConfig {
	maxConcurrent: number;
	requestsPerSecond: number;
}

// ── Crawl Policy ───────────────────────────────────────────────────

export interface CrawlPolicy {
	enabled: boolean;
	respectRobotsTxt: boolean;
	maxDepth: number;
	filterLinks?: (url: string) => boolean;
}

// ── Site Definition ────────────────────────────────────────────────

export interface SiteDefinition {
	name: string;
	domain: string;
	aliases?: readonly string[];
	normalizeUrl: (url: string) => string;
	rateLimit: RateLimitConfig;
	resources: Record<string, ResourceDef>;
	pages: Record<string, PageDef>;
	crawl: CrawlPolicy;
	driver?: "cheerio" | "jsdom" | "playwright";
	allowedFetchDomains?: readonly string[];
}
