import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SiteDefinition } from "../types.js";
import {
	type CheckContext,
	runDeterminism,
	runErrorPathCoverage,
	runFixtureExtraction,
	runLocaleMatrix,
	runManifestIntegrity,
	runSchemaConformance,
	runSchemaEmissionRoundtrip,
	runSecuritySandbox,
} from "./checks.js";
import { discoverFixtures } from "./fixtures.js";
import type { CheckName, CheckResult, TestPackageOptions, TestPackageResult } from "./types.js";

const ALL_CHECKS: CheckName[] = [
	"fixture-extraction",
	"schema-conformance",
	"determinism",
	"schema-emission-roundtrip",
	"locale-matrix",
	"error-path-coverage",
	"manifest-integrity",
	"security-sandbox",
];

/**
 * Run the 8 must-pass CI checks against a built site package.
 *
 * Per atlas §7 + §9: this is what `sitely test` invokes. Each fixture
 * runs in a `worker_threads.Worker` under capability constraints declared
 * in the manifest. Capability violations during any extract = test failure
 * (atlas §8 — "the test harness IS the sandbox").
 *
 * Returns a structured report with per-check results + aggregated failures.
 * The exit code on the CLI side is `1` when `ok === false`.
 */
export async function testPackage(opts: TestPackageOptions): Promise<TestPackageResult> {
	const packageRoot = resolve(opts.packageRoot);

	const site = await loadSiteDefinition(packageRoot);
	if (!site) {
		return {
			ok: false,
			results: [],
			failures: [
				{
					check: "fixture-extraction",
					message: `No site definition found in ${packageRoot}/dist/index.js or ${packageRoot}/index.ts`,
				},
			],
		};
	}
	const siteModulePath = locateSiteModulePath(packageRoot);
	if (!siteModulePath) {
		return {
			ok: false,
			results: [],
			failures: [
				{
					check: "fixture-extraction",
					message: `No loadable site module found in ${packageRoot}/dist/index.js or ${packageRoot}/index.ts`,
				},
			],
		};
	}

	const fixtures = discoverFixtures(packageRoot);
	const ctx: CheckContext = { packageRoot, site, siteModulePath, fixtures };

	const wanted = opts.only && opts.only.length > 0 ? opts.only : ALL_CHECKS;
	const results: CheckResult[] = [];

	for (const check of wanted) {
		const result = await runCheck(check, ctx);
		results.push(result);
	}

	const failures = results.flatMap((r) => r.failures);
	const ok = results.every((r) => r.ok);
	return { ok, results, failures };
}

async function runCheck(check: CheckName, ctx: CheckContext): Promise<CheckResult> {
	switch (check) {
		case "fixture-extraction":
			return runFixtureExtraction(ctx);
		case "schema-conformance":
			return runSchemaConformance(ctx);
		case "determinism":
			return runDeterminism(ctx);
		case "schema-emission-roundtrip":
			return runSchemaEmissionRoundtrip(ctx);
		case "locale-matrix":
			return runLocaleMatrix(ctx);
		case "error-path-coverage":
			return runErrorPathCoverage(ctx);
		case "manifest-integrity":
			return runManifestIntegrity(ctx);
		case "security-sandbox":
			return runSecuritySandbox(ctx);
	}
}

async function loadSiteDefinition(packageRoot: string): Promise<SiteDefinition | null> {
	const candidates = [
		join(packageRoot, "dist", "index.js"),
		join(packageRoot, "index.ts"),
		join(packageRoot, "src", "index.ts"),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const mod = await import(pathToFileURL(candidate).href);
			const def = mod.default ?? mod.site ?? null;
			if (def && typeof def === "object") return def as SiteDefinition;
		} catch {
			// Try next candidate.
		}
	}
	return null;
}

function locateSiteModulePath(packageRoot: string): string | null {
	const candidates = [
		join(packageRoot, "dist", "index.js"),
		join(packageRoot, "index.ts"),
		join(packageRoot, "src", "index.ts"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return pathToFileURL(candidate).href;
	}
	return null;
}

export type {
	CheckFailure,
	CheckName,
	CheckResult,
	TestPackageOptions,
	TestPackageResult,
} from "./types.js";
