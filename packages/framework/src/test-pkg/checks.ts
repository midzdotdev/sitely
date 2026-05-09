import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import stableStringify from "fast-json-stable-stringify";
import { diff as jestDiff } from "jest-diff";
import { buildPackage } from "../build/index.js";
import { stableSerialize } from "../build/serialize.js";
import { matchPagePattern } from "../test-harness.js";
import { validateExtraction } from "@sitely/schemas";
import type { SiteDefinition } from "../types.js";
import type { Fixture } from "./fixtures.js";
import { runExtractionInWorker } from "./runner.js";
import type { CheckFailure, CheckResult } from "./types.js";

export interface CheckContext {
	packageRoot: string;
	site: SiteDefinition;
	siteModulePath: string;
	fixtures: Fixture[];
}

/**
 * Atlas §9 #1 — fixture extraction match.
 *
 * For every happy-path fixture with a sibling `<name>.expected.json`, run
 * `validate` + `extract` and assert the result equals the expected JSON.
 * Fixtures without an `expected.json` are skipped (warning, not failure).
 */
export async function runFixtureExtraction(ctx: CheckContext): Promise<CheckResult> {
	const failures: CheckFailure[] = [];
	let count = 0;

	for (const fixture of ctx.fixtures) {
		if (fixture.isErrorFixture) continue;
		if (!fixture.expected) continue;
		count++;

		const url = fixture.meta?.url ?? `https://${ctx.site.origins[0].hostname}/`;
		const match = matchPagePattern(ctx.site, url);
		if (!match) {
			failures.push({
				check: "fixture-extraction",
				fixture: fixture.name,
				locale: fixture.locale,
				message: `fixture URL "${url}" does not match any page pattern`,
			});
			continue;
		}

		const result = await runExtractionInWorker({
			site: ctx.site,
			siteModulePath: ctx.siteModulePath,
			fixture,
			pageKey: match.pageKey,
			params: match.params,
		});

		if (result.kind !== "ok") {
			failures.push({
				check: "fixture-extraction",
				fixture: fixture.name,
				locale: fixture.locale,
				page: match.pageKey,
				message: describeRunFailure(result),
				detail: result,
			});
			continue;
		}

		const actualJson = stableStringify(result.data);
		const expectedJson = stableStringify(fixture.expected);
		if (actualJson !== expectedJson) {
			const diff = jestDiff(JSON.parse(expectedJson), JSON.parse(actualJson));
			failures.push({
				check: "fixture-extraction",
				fixture: fixture.name,
				locale: fixture.locale,
				page: match.pageKey,
				message: "extracted output does not match expected.json",
				detail: diff,
			});
		}
	}

	return { check: "fixture-extraction", ok: failures.length === 0, failures, count };
}

/**
 * Atlas §9 #2 — schema conformance.
 *
 * Run the runtime Standard Schema validator against the extracted output
 * for each (resource, fixture) pair. Detects shape drift between extractor
 * and declared schema.
 */
export async function runSchemaConformance(ctx: CheckContext): Promise<CheckResult> {
	const failures: CheckFailure[] = [];
	let count = 0;

	for (const fixture of ctx.fixtures) {
		if (fixture.isErrorFixture) continue;

		const url = fixture.meta?.url ?? `https://${ctx.site.origins[0].hostname}/`;
		const match = matchPagePattern(ctx.site, url);
		if (!match) continue;
		const page = ctx.site.pages[match.pageKey];
		if (!page) continue;

		const result = await runExtractionInWorker({
			site: ctx.site,
			siteModulePath: ctx.siteModulePath,
			fixture,
			pageKey: match.pageKey,
			params: match.params,
		});
		if (result.kind !== "ok") continue; // owned by other checks

		for (const resourceName of page.provides) {
			const resource = ctx.site.resources[resourceName];
			if (!resource) continue;
			const validator = ctx.site.schemas[resource.schema];
			if (!validator) continue;
			const extracted = result.data[resourceName];
			if (extracted === undefined) continue;
			count++;

			const validation = validateExtraction(validator, extracted);
			if (!validation.success) {
				failures.push({
					check: "schema-conformance",
					fixture: fixture.name,
					locale: fixture.locale,
					page: match.pageKey,
					resource: resourceName,
					message: `extraction failed schema "${resource.schema}" validation`,
					detail: validation.errors,
				});
			}
		}
	}

	return { check: "schema-conformance", ok: failures.length === 0, failures, count };
}

/**
 * Atlas §9 #3 + addendum-1 §2 — determinism.
 *
 * Run extract twice on each fixture. Assert byte-identical output after
 * stable serialization. On failure, render a `jest-diff` of the two outputs
 * so the author can see *which field* is non-deterministic (addendum-1 §2).
 */
export async function runDeterminism(ctx: CheckContext): Promise<CheckResult> {
	const failures: CheckFailure[] = [];
	let count = 0;

	for (const fixture of ctx.fixtures) {
		if (fixture.isErrorFixture) continue;

		const url = fixture.meta?.url ?? `https://${ctx.site.origins[0].hostname}/`;
		const match = matchPagePattern(ctx.site, url);
		if (!match) continue;
		count++;

		const a = await runExtractionInWorker({
			site: ctx.site,
			siteModulePath: ctx.siteModulePath,
			fixture,
			pageKey: match.pageKey,
			params: match.params,
		});
		const b = await runExtractionInWorker({
			site: ctx.site,
			siteModulePath: ctx.siteModulePath,
			fixture,
			pageKey: match.pageKey,
			params: match.params,
		});

		if (a.kind !== "ok" || b.kind !== "ok") continue;

		const ja = stableStringify(a.data);
		const jb = stableStringify(b.data);
		if (ja !== jb) {
			failures.push({
				check: "determinism",
				fixture: fixture.name,
				locale: fixture.locale,
				message: "extraction is not deterministic — run 1 and run 2 produced different output",
				detail: jestDiff(JSON.parse(ja), JSON.parse(jb)),
			});
		}
	}

	return { check: "determinism", ok: failures.length === 0, failures, count };
}

/**
 * Atlas §9 #4 — schema-emission round-trip.
 *
 * Validate every successful extraction against the JSON Schema the build
 * step emitted. Catches drift between the runtime validator and the
 * emitted JSON Schema (the emitter has a bug, the validator uses a
 * non-portable feature, etc).
 *
 * Requires `dist/schemas/<Name>.json` to exist — run `sitely build` first.
 */
export async function runSchemaEmissionRoundtrip(ctx: CheckContext): Promise<CheckResult> {
	const failures: CheckFailure[] = [];
	let count = 0;

	const schemasDir = join(ctx.packageRoot, "dist", "schemas");
	if (!existsSync(schemasDir)) {
		return {
			check: "schema-emission-roundtrip",
			ok: false,
			failures: [
				{
					check: "schema-emission-roundtrip",
					message: `dist/schemas/ not found at ${schemasDir} — run \`sitely build\` first`,
				},
			],
			count: 0,
		};
	}

	const ajv = new Ajv2020({ strict: false, allErrors: true });
	const validators = new Map<string, ReturnType<typeof ajv.compile>>();

	for (const fixture of ctx.fixtures) {
		if (fixture.isErrorFixture) continue;
		const url = fixture.meta?.url ?? `https://${ctx.site.origins[0].hostname}/`;
		const match = matchPagePattern(ctx.site, url);
		if (!match) continue;
		const page = ctx.site.pages[match.pageKey];
		if (!page) continue;

		const result = await runExtractionInWorker({
			site: ctx.site,
			siteModulePath: ctx.siteModulePath,
			fixture,
			pageKey: match.pageKey,
			params: match.params,
		});
		if (result.kind !== "ok") continue;

		for (const resourceName of page.provides) {
			const resource = ctx.site.resources[resourceName];
			if (!resource) continue;
			const extracted = result.data[resourceName];
			if (extracted === undefined) continue;
			count++;

			let validator = validators.get(resource.schema);
			if (!validator) {
				const schemaPath = join(schemasDir, `${resource.schema}.json`);
				if (!existsSync(schemaPath)) {
					failures.push({
						check: "schema-emission-roundtrip",
						resource: resourceName,
						message: `dist/schemas/${resource.schema}.json missing`,
					});
					continue;
				}
				const jsonSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));
				validator = ajv.compile(jsonSchema);
				validators.set(resource.schema, validator);
			}

			if (!validator(extracted)) {
				failures.push({
					check: "schema-emission-roundtrip",
					fixture: fixture.name,
					locale: fixture.locale,
					page: match.pageKey,
					resource: resourceName,
					message: `extraction failed Ajv validation against dist/schemas/${resource.schema}.json`,
					detail: validator.errors,
				});
			}
		}
	}

	return { check: "schema-emission-roundtrip", ok: failures.length === 0, failures, count };
}

/**
 * Atlas §9 #5 — locale matrix.
 *
 * For sites that declare `locales` with more than one value, require
 * fixtures for at least two distinct locales for each page that has any
 * fixture. Single-locale fixtures pass with a warning, not a failure
 * (atlas §3 — "some pages legitimately only exist in one locale").
 *
 * Sites without a `locales` block are not subject to this check.
 */
export function runLocaleMatrix(ctx: CheckContext): CheckResult {
	const failures: CheckFailure[] = [];
	let count = 0;

	if (!ctx.site.locales || ctx.site.locales.values.length < 2) {
		return { check: "locale-matrix", ok: true, failures: [], count: 0 };
	}

	// Build {pageKey -> Set<locale>} from fixtures.
	const localesPerPage = new Map<string, Set<string>>();
	for (const fixture of ctx.fixtures) {
		if (fixture.isErrorFixture) continue;
		const url = fixture.meta?.url ?? `https://${ctx.site.origins[0].hostname}/`;
		const match = matchPagePattern(ctx.site, url);
		if (!match) continue;
		const set = localesPerPage.get(match.pageKey) ?? new Set<string>();
		if (fixture.locale) set.add(fixture.locale);
		localesPerPage.set(match.pageKey, set);
	}

	for (const [pageKey, locales] of localesPerPage) {
		count++;
		if (locales.size < 2) {
			failures.push({
				check: "locale-matrix",
				page: pageKey,
				message: `page "${pageKey}" has fixtures for only ${locales.size} locale (${[...locales].join(", ") || "none"}); declare fixtures for at least two of [${ctx.site.locales.values.join(", ")}]`,
			});
		}
	}

	return { check: "locale-matrix", ok: failures.length === 0, failures, count };
}

/**
 * Atlas §9 #6 — error-path coverage.
 *
 * For every `<name>.error.html` fixture, assert that `validate(ctx)` returns
 * `false`. This proves the validator correctly distinguishes block/captcha/
 * stub pages from real ones.
 *
 * If a site has no error fixtures at all, the check passes with a warning
 * (we don't force authors to invent error fixtures, but flag the gap).
 */
export async function runErrorPathCoverage(ctx: CheckContext): Promise<CheckResult> {
	const failures: CheckFailure[] = [];
	let count = 0;

	const errorFixtures = ctx.fixtures.filter((f) => f.isErrorFixture);
	if (errorFixtures.length === 0) {
		return {
			check: "error-path-coverage",
			ok: true,
			failures: [
				{
					check: "error-path-coverage",
					message:
						"no .error.html fixtures declared — error-path coverage is a gap (atlas §9 #6); add at least one when convenient",
				},
			],
			count: 0,
		};
	}

	for (const fixture of errorFixtures) {
		count++;
		const url = fixture.meta?.url ?? `https://${ctx.site.origins[0].hostname}/`;
		const match = matchPagePattern(ctx.site, url);
		if (!match) {
			failures.push({
				check: "error-path-coverage",
				fixture: fixture.name,
				locale: fixture.locale,
				message: `error fixture URL "${url}" does not match any page pattern`,
			});
			continue;
		}

		const result = await runExtractionInWorker({
			site: ctx.site,
			siteModulePath: ctx.siteModulePath,
			fixture,
			pageKey: match.pageKey,
			params: match.params,
		});

		if (result.kind === "validate-false") {
			// expected
		} else if (result.kind === "ok") {
			failures.push({
				check: "error-path-coverage",
				fixture: fixture.name,
				locale: fixture.locale,
				page: match.pageKey,
				message: `error fixture passed validate() — expected false. The validator should reject block/captcha/stub pages.`,
			});
		} else {
			failures.push({
				check: "error-path-coverage",
				fixture: fixture.name,
				locale: fixture.locale,
				page: match.pageKey,
				message: describeRunFailure(result),
				detail: result,
			});
		}
	}

	return { check: "error-path-coverage", ok: failures.length === 0, failures, count };
}

/**
 * Atlas §9 #7 — manifest integrity.
 *
 * Re-run `buildPackage` (dryRun) and compare the freshly-built manifest
 * against the checked-in `dist/manifest.json`. If they differ, the package
 * was published with a stale or hand-edited manifest.
 *
 * This is THE check that protects the manifest-as-source-of-truth contract
 * (atlas §0). On failure, prints a jest-diff so the author can see exactly
 * which field drifted.
 */
export async function runManifestIntegrity(ctx: CheckContext): Promise<CheckResult> {
	const manifestPath = join(ctx.packageRoot, "dist", "manifest.json");
	if (!existsSync(manifestPath)) {
		return {
			check: "manifest-integrity",
			ok: false,
			failures: [
				{
					check: "manifest-integrity",
					message: `dist/manifest.json not found at ${manifestPath} — run \`sitely build\` first`,
				},
			],
			count: 0,
		};
	}

	const onDisk = readFileSync(manifestPath, "utf-8");
	const fresh = await buildPackage({ packageRoot: ctx.packageRoot, dryRun: true });
	if (!fresh.ok || !fresh.manifestJson) {
		return {
			check: "manifest-integrity",
			ok: false,
			failures: [
				{
					check: "manifest-integrity",
					message: "regenerating manifest failed — see build errors",
					detail: fresh.errors,
				},
			],
			count: 1,
		};
	}

	if (onDisk !== fresh.manifestJson) {
		return {
			check: "manifest-integrity",
			ok: false,
			failures: [
				{
					check: "manifest-integrity",
					message:
						"dist/manifest.json does not match a fresh build — package was shipped with a stale manifest. Run `sitely build` and commit the result.",
					detail: jestDiff(JSON.parse(onDisk), JSON.parse(fresh.manifestJson)),
				},
			],
			count: 1,
		};
	}

	return { check: "manifest-integrity", ok: true, failures: [], count: 1 };
}

/**
 * Atlas §9 #8 — security smoke + sandbox.
 *
 * Re-aggregates capability violations observed across the other checks.
 * This check exists so the harness can produce a single "did the sandbox
 * catch anything?" verdict, even when the violation was first surfaced
 * during fixture-extraction or determinism.
 *
 * Implementation: run every happy-path fixture once, treat any
 * `kind: "capability-violation"` from the worker as a security failure.
 * Other failure kinds are ignored here (owned by other checks).
 */
export async function runSecuritySandbox(ctx: CheckContext): Promise<CheckResult> {
	const failures: CheckFailure[] = [];
	let count = 0;

	for (const fixture of ctx.fixtures) {
		if (fixture.isErrorFixture) continue;
		const url = fixture.meta?.url ?? `https://${ctx.site.origins[0].hostname}/`;
		const match = matchPagePattern(ctx.site, url);
		if (!match) continue;
		count++;

		const result = await runExtractionInWorker({
			site: ctx.site,
			siteModulePath: ctx.siteModulePath,
			fixture,
			pageKey: match.pageKey,
			params: match.params,
		});

		if (result.kind === "capability-violation") {
			failures.push({
				check: "security-sandbox",
				fixture: fixture.name,
				locale: fixture.locale,
				page: match.pageKey,
				message: `capability violation: ${result.capability} — attempted ${result.attempted}`,
				detail: result,
			});
		}
	}

	return { check: "security-sandbox", ok: failures.length === 0, failures, count };
}

function describeRunFailure(result: ExtractionRunFailure): string {
	switch (result.kind) {
		case "capability-violation":
			return `capability violation: ${result.capability} — attempted ${result.attempted}`;
		case "validate-false":
			return "validate() returned false on a happy-path fixture";
		case "error":
			return `worker error: ${result.message}`;
		default:
			return "unknown extraction failure";
	}
}

type ExtractionRunFailure = Exclude<
	Awaited<ReturnType<typeof runExtractionInWorker>>,
	{ kind: "ok" }
>;
