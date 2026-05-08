import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestContext, matchPagePattern, testExtract } from "./test-harness.js";
import type { SiteDefinition } from "./types.js";

/** A mapping from a fixture file to the URL it was captured from. */
export interface FixtureMapping {
	/** Fixture filename inside `fixtures/` (e.g. `"wiki-typescript.html"`). */
	fixture: string;
	/** The URL this fixture was captured from. */
	url: string;
	/** Override route params (auto-extracted from URL via `matchPagePattern` if omitted). */
	params?: Record<string, string>;
}

/** Options for {@link describePageExtraction}. */
export interface PageExtractionOptions {
	/** The site definition. */
	site: SiteDefinition;
	/** The page pattern key (e.g. `"/wiki/:title"`). */
	pageKey: string;
	/** Fixture loader function (from {@link createFixtureLoader}). */
	loadFixture: (name: string) => string;
	/** One or more fixture mappings to test against. */
	fixtures: FixtureMapping[];
	/**
	 * Custom assertion function called after extraction succeeds.
	 * Receives the extracted data for site-specific field checks.
	 */
	assertExtraction?: (
		data: Record<string, unknown>,
		fixture: FixtureMapping,
	) => void | Promise<void>;
	/**
	 * HTML used to test that `validate()` rejects non-matching pages.
	 * Defaults to a generic block page.
	 */
	rejectHtml?: string;
}

/**
 * Create a fixture-loading function scoped to the calling site's directory.
 *
 * @param importMetaUrl - Pass `import.meta.url` from the test file.
 * @returns A function that reads `fixtures/<name>` relative to the test file.
 */
export function createFixtureLoader(importMetaUrl: string): (name: string) => string {
	const dir = dirname(fileURLToPath(importMetaUrl));
	return (name: string) => readFileSync(resolve(dir, "fixtures", name), "utf-8");
}

/**
 * Load and parse the `fixtures.json` manifest from a site directory.
 *
 * @param importMetaUrl - Pass `import.meta.url` from the test file.
 * @returns A map from page pattern to fixture mappings.
 */
export function loadFixtureManifest(importMetaUrl: string): Record<string, FixtureMapping[]> {
	const dir = dirname(fileURLToPath(importMetaUrl));
	const raw = readFileSync(resolve(dir, "fixtures.json"), "utf-8");
	return JSON.parse(raw);
}

/**
 * Generate extraction tests for a specific page.
 *
 * For each fixture, auto-generates:
 * - `validate()` returns `true`
 * - `testExtract()` succeeds and every provided resource is present
 * - Custom `assertExtraction` callback (if provided)
 *
 * Also tests that `validate()` returns `false` for a rejection page.
 */
export function describePageExtraction(opts: PageExtractionOptions): void {
	const { site, pageKey, loadFixture, fixtures, assertExtraction, rejectHtml } = opts;
	const page = site.pages[pageKey];

	describe(`extraction: ${pageKey}`, () => {
		for (const fixtureMapping of fixtures) {
			const html = loadFixture(fixtureMapping.fixture);
			const autoMatch = matchPagePattern(site, fixtureMapping.url);
			const params = fixtureMapping.params ?? autoMatch?.params ?? {};

			describe(fixtureMapping.fixture, () => {
				it("validates the page", () => {
					const ctx = createTestContext({ html, url: fixtureMapping.url, params });
					expect(page.validate(ctx)).toBe(true);
				});

				it("extracts without error", async () => {
					const result = await testExtract(site, pageKey, {
						html,
						url: fixtureMapping.url,
						params,
					});
					expect(result).toBeDefined();
					for (const resourceName of page.provides) {
						expect(result[resourceName], `missing resource "${resourceName}"`).toBeDefined();
					}
				});

				if (assertExtraction) {
					it("passes custom assertions", async () => {
						const result = await testExtract(site, pageKey, {
							html,
							url: fixtureMapping.url,
							params,
						});
						await assertExtraction(result, fixtureMapping);
					});
				}
			});
		}

		it("rejects invalid page", () => {
			const reject = rejectHtml ?? "<html><body>Access Denied</body></html>";
			const firstFixture = fixtures[0];
			const autoMatch = matchPagePattern(site, firstFixture.url);
			const params = firstFixture.params ?? autoMatch?.params ?? {};
			const ctx = createTestContext({ html: reject, url: firstFixture.url, params });
			expect(page.validate(ctx)).toBe(false);
		});
	});
}
