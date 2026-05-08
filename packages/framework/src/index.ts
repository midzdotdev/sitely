/**
 * `@wapi/framework` is the core site definition DSL for WAPI.
 *
 * Use {@link defineSite} to create site definitions that describe how to
 * extract structured data from websites. The framework provides:
 *
 * - **Site definitions** — declarative descriptions of a website's structure
 * - **Extraction context** — DOM querying, JSON-LD, and media tracking
 * - **Test utilities** — run extractors against HTML fixtures without network calls
 * - **Robots.txt parsing** — respect crawl policies
 *
 * @packageDocumentation
 */

// Core
export { defineSite } from "./define-site.js";
export { createExtractContext } from "./context.js";
export type { CreateContextOptions } from "./context.js";
export { extractJsonLd, filterJsonLdByType } from "./json-ld.js";
export { parseRobotsTxt } from "./robots.js";
export type { RobotsChecker } from "./robots.js";
export { generateOpenApiSpec } from "./openapi.js";

// Test utilities (vitest-free — safe to import at runtime)
export { createTestContext, matchPagePattern, matchPattern, testExtract } from "./test-harness.js";
export type { TestHarnessOptions } from "./test-harness.js";

// Vitest-dependent test helpers are exported from "@wapi/framework/testing"
// to avoid pulling vitest into runtime/CLI imports.
// See ./testing.ts for: createFixtureLoader, loadFixtureManifest, describePageExtraction

// Types
export type {
	ExtractContext,
	MediaRef,
	ParamDef,
	ResourceDef,
	PaginateDef,
	PageDef,
	RateLimitConfig,
	CrawlConfig,
	SiteDefinition,
} from "./types.js";

// Re-export schemas for convenience
export { Schema } from "@wapi/schemas";
