/**
 * Injected cross-site validation.
 *
 * Auto-discovers all site directories under sites/ and validates structural
 * invariants. Site developers do not need to opt-in — this runs automatically.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matchPagePattern } from "@sitely/framework/testing";
import type { SiteDefinition } from "@sitely/framework/testing";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FixtureEntry {
	fixture: string;
	url: string;
}

// Discover all site directories (skip _ prefixed and node_modules)
const siteDirs = readdirSync(__dirname, { withFileTypes: true })
	.filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "node_modules")
	.map((d) => ({ name: d.name, path: resolve(__dirname, d.name) }))
	.filter(({ path }) => existsSync(resolve(path, "index.ts")));

for (const { name, path } of siteDirs) {
	describe(name, async () => {
		const mod = await import(pathToFileURL(resolve(path, "index.ts")).href);
		const site: SiteDefinition = mod.default;

		// --- Site definition validity ---

		describe("site definition", () => {
			it("exports a valid default", () => {
				expect(site).toBeDefined();
				expect(typeof site.name).toBe("string");
				expect(site.name.length).toBeGreaterThan(0);
			});

			it("has a valid domain", () => {
				expect(site.domain).toBeTruthy();
				expect(site.domain).not.toContain("://");
			});

			it("has valid rate limit config", () => {
				expect(site.rateLimit.maxConcurrent).toBeGreaterThan(0);
				expect(site.rateLimit.requestsPerSecond).toBeGreaterThan(0);
			});
		});

		// --- Resources ---

		describe("resources", () => {
			for (const [resourceName, resource] of Object.entries(site.resources)) {
				describe(resourceName, () => {
					it("has a valid schema type", () => {
						expect(resource.schema).toBeTruthy();
					});

					it("resolve returns a path", () => {
						const testParams: Record<string, string> = {};
						for (const [pName, pDef] of Object.entries(resource.params)) {
							testParams[pName] = pDef.type === "number" ? "1" : "test";
						}
						const resolved = resource.resolve(testParams);
						expect(typeof resolved).toBe("string");
						expect(resolved.startsWith("/") || resolved.startsWith("?")).toBe(true);
					});

					it("has a valid ttl", () => {
						expect(resource.ttl).toMatch(/^\d+[smhd]$/);
					});
				});
			}
		});

		// --- Pages ---

		describe("pages", () => {
			for (const [pattern, page] of Object.entries(site.pages)) {
				describe(pattern, () => {
					it("provides at least one resource", () => {
						expect(page.provides.length).toBeGreaterThan(0);
					});

					it("provides only defined resources", () => {
						for (const resourceName of page.provides) {
							expect(
								site.resources[resourceName],
								`"${resourceName}" not in site.resources`,
							).toBeDefined();
						}
					});

					it("has at least one example URL", () => {
						expect(page.examples.length).toBeGreaterThan(0);
					});

					for (const exampleUrl of page.examples) {
						it(`example "${exampleUrl}" matches this pattern`, () => {
							const match = matchPagePattern(site, exampleUrl);
							expect(match, "URL did not match any pattern").not.toBeNull();
							expect(match!.pageKey).toBe(pattern);
						});
					}
				});
			}
		});

		// --- normalizeUrl idempotency ---

		if (site.normalizeUrl) {
			describe("normalizeUrl", () => {
				const allExamples = Object.values(site.pages).flatMap((p) => p.examples);
				for (const url of allExamples) {
					it(`is idempotent for "${url}"`, () => {
						const once = site.normalizeUrl!(url);
						const twice = site.normalizeUrl!(once);
						expect(once).toBe(twice);
					});
				}
			});
		}

		// --- Fixture manifest ---

		describe("fixtures", () => {
			const fixturesJsonPath = resolve(path, "fixtures.json");

			it("has a fixtures.json manifest", () => {
				expect(existsSync(fixturesJsonPath), "missing fixtures.json").toBe(true);
			});

			it("has a fixtures/ directory", () => {
				expect(existsSync(resolve(path, "fixtures")), "missing fixtures/").toBe(true);
			});

			// Only run detailed fixture checks if the manifest exists
			if (existsSync(fixturesJsonPath)) {
				const manifest: Record<string, FixtureEntry[]> = JSON.parse(
					readFileSync(fixturesJsonPath, "utf-8"),
				);

				for (const pattern of Object.keys(site.pages)) {
					it(`"${pattern}" has fixtures in manifest`, () => {
						expect(manifest[pattern], `no fixtures.json entry for "${pattern}"`).toBeDefined();
						expect(manifest[pattern].length).toBeGreaterThan(0);
					});
				}

				for (const [pattern, entries] of Object.entries(manifest)) {
					for (const entry of entries) {
						it(`fixture "${entry.fixture}" for "${pattern}" exists on disk`, () => {
							const filePath = resolve(path, "fixtures", entry.fixture);
							expect(existsSync(filePath), `missing ${entry.fixture}`).toBe(true);
						});
					}
				}
			}

			it("has a test file", () => {
				expect(existsSync(resolve(path, "index.test.ts")), "missing index.test.ts").toBe(true);
			});
		});
	});
}
