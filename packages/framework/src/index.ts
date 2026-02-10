// Core
export { defineSite } from "./define-site.js";
export { createExtractContext } from "./context.js";
export type { CreateContextOptions } from "./context.js";

// Utilities
export { parseJsonLd, getCanonicalFromHtml } from "./json-ld.js";
export { isAllowedByRobots } from "./robots.js";

// Test harness
export { createFixtureTest } from "./test-harness.js";
export type { FixtureTestOptions, FixtureTestResult } from "./test-harness.js";

// Types
export type {
	SiteDefinition,
	ExtractContext,
	PageDef,
	PaginateDef,
	ResourceDef,
	ParamDef,
	RateLimitConfig,
	CrawlPolicy,
	MediaRef,
} from "./types.js";

// Re-export Schema constant for convenience
export { Schema } from "@wapi/schemas";
export type { SchemaType } from "@wapi/schemas";
