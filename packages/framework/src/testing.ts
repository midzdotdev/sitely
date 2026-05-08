/**
 * Vitest-dependent test helpers for site authors.
 *
 * Import from `@sitely/framework/testing` in test files.
 * These are separated from the main entry point so that runtime
 * code (CLI, server) can import `@sitely/framework` without pulling in vitest.
 *
 * @packageDocumentation
 */

// Re-export everything from the main entry (so test files can import from one place)
export * from "./index.js";

// Vitest-dependent helpers
export {
	createFixtureLoader,
	loadFixtureManifest,
	describePageExtraction,
} from "./site-test-utils.js";
export type { FixtureMapping, PageExtractionOptions } from "./site-test-utils.js";
