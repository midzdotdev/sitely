/**
 * `@sitely/framework` is the core site definition DSL for sitely.
 *
 * Use {@link defineSite} to create site definitions that describe how to
 * extract structured data from websites. The framework provides:
 *
 * - **Site definitions** — declarative descriptions of a website's structure (DSL v2)
 * - **Extraction context** — DOM querying, JSON-LD, and media tracking
 * - **Origin resolution** — locale-aware hostname derivation
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

// Origin / locale derivation
export { getActiveOrigins, getAllHostnames, getPrimaryHostname } from "./origins.js";

// Build / validate / snapshot / capabilities — atlas spec §0/§5/§7/§8/§10 primitives
export {
	buildPackage,
	DEFAULT_CAPABILITIES,
	parseTTL,
	resolveCapabilities,
	snapshotUrl,
	stableSerialize,
	urlToFixtureName,
	validatePackage,
	validateTTL,
} from "./build/index.js";
export type {
	BuildPackageOptions,
	BuildPackageResult,
	Manifest,
	SnapshotMeta,
	SnapshotResult,
	SnapshotUrlOptions,
	ValidatePackageOptions,
	ValidatePackageResult,
	ValidationError,
} from "./build/index.js";

// Standard Schema types
export type { StandardSchemaV1 } from "./standard-schema.js";

// Test utilities (vitest-free — safe to import at runtime)
export { createTestContext, matchPagePattern, matchPattern, testExtract } from "./test-harness.js";
export type { TestHarnessOptions } from "./test-harness.js";

// 8 must-pass CI checks (atlas spec §7/§9) — `sitely test` invokes this.
export { testPackage } from "./test-pkg/index.js";
export type {
	CheckFailure,
	CheckName,
	CheckResult,
	TestPackageOptions,
	TestPackageResult,
} from "./test-pkg/index.js";

// Vitest-dependent test helpers are exported from "@sitely/framework/testing"
// to avoid pulling vitest into runtime/CLI imports.
// See ./testing.ts for: createFixtureLoader, loadFixtureManifest, describePageExtraction

// Types
export type {
	CapabilityConfig,
	CrawlConfig,
	ExtractContext,
	FamilyConfig,
	FrameworkRange,
	LocaleConfig,
	MediaRef,
	Origin,
	PageDef,
	PaginateDef,
	ParamDef,
	RateLimitConfig,
	ResourceDef,
	ResourceTTL,
	SiteDefinition,
	SiteIdentity,
} from "./types.js";
