import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SiteDefinition } from "../types.js";
import { buildManifest } from "./manifest.js";
import type { Manifest } from "./manifest-types.js";
import { emitJsonSchema } from "./schemas.js";
import { stableSerialize } from "./serialize.js";
import { type ValidationError, validateSite } from "./validate.js";

export interface BuildPackageOptions {
	/** Absolute path to the package root (containing package.json + dist/). */
	packageRoot: string;
	/** When `true`, do not write to disk — return what would be written. Default: `false`. */
	dryRun?: boolean;
	/** Override the framework tool string in the manifest's `build.tool` field. */
	tool?: string;
}

export interface BuildPackageResult {
	ok: boolean;
	errors: ValidationError[];
	manifest?: Manifest;
	manifestJson?: string;
	schemas?: Record<string, string>;
	writtenFiles?: string[];
}

/**
 * Build a site package — emit `dist/manifest.json` + `dist/schemas/*.json`
 * + leave the existing `dist/*.js` (compiled by tsc) alone.
 *
 * Per atlas §0/§7: this is the single emitter. Validations run BEFORE any
 * file is written; on failure, returns `{ok: false, errors}` with nothing
 * touched on disk.
 *
 * Determinism contract: regenerating against the same git HEAD produces
 * byte-identical output. The manifest-integrity CI check (atlas §9 #7)
 * verifies this by re-running build and diffing against the checked-in
 * `dist/manifest.json`.
 */
export async function buildPackage(opts: BuildPackageOptions): Promise<BuildPackageResult> {
	const packageRoot = resolve(opts.packageRoot);
	const distDir = join(packageRoot, "dist");

	// Load package metadata.
	const pkgJsonPath = join(packageRoot, "package.json");
	if (!existsSync(pkgJsonPath)) {
		return {
			ok: false,
			errors: [
				{
					kind: "missing-site-id",
					message: `package.json not found at ${pkgJsonPath}`,
				},
			],
		};
	}
	const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
		name: string;
		version: string;
	};

	// Load the site definition. Prefer the compiled JS so we don't need a TS
	// loader at build time; fall back to source for in-repo dev.
	const site = await loadSiteDefinition(packageRoot);
	if (!site) {
		return {
			ok: false,
			errors: [
				{
					kind: "missing-site-id",
					message: `No site definition found in ${packageRoot}/dist/index.js or src/index.ts`,
				},
			],
		};
	}

	// Validate before emitting. Any error = no files written.
	const errors = validateSite(site);
	if (errors.length > 0) {
		return { ok: false, errors };
	}

	// Build the manifest.
	const manifest = buildManifest(site, pkg, {
		packageRoot,
		tool: opts.tool ?? `sitely-cli@${pkg.version}`,
	});
	const manifestJson = stableSerialize(manifest);

	// Emit JSON Schema files (one per declared schema).
	const schemaFiles: Record<string, string> = {};
	for (const [name, schema] of Object.entries(site.schemas)) {
		const jsonSchema = emitJsonSchema(schema, name);
		schemaFiles[name] = stableSerialize(jsonSchema);
	}

	if (opts.dryRun) {
		return { ok: true, errors: [], manifest, manifestJson, schemas: schemaFiles };
	}

	// Write to disk. Idempotent — overwrites if exists.
	const written: string[] = [];

	if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
	const manifestPath = join(distDir, "manifest.json");
	writeFileSync(manifestPath, manifestJson, "utf-8");
	written.push(manifestPath);

	const schemasDir = join(distDir, "schemas");
	if (!existsSync(schemasDir)) mkdirSync(schemasDir, { recursive: true });
	for (const [name, contents] of Object.entries(schemaFiles)) {
		const schemaPath = join(schemasDir, `${name}.json`);
		writeFileSync(schemaPath, contents, "utf-8");
		written.push(schemaPath);
	}

	return { ok: true, errors: [], manifest, manifestJson, schemas: schemaFiles, writtenFiles: written };
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
			// Ignore and try next candidate.
		}
	}
	return null;
}

/** Re-export public types for consumers. */
export type { Manifest } from "./manifest-types.js";
export type { ValidationError } from "./validate.js";
export { validatePackage } from "./validate-package.js";
export type { ValidatePackageOptions, ValidatePackageResult } from "./validate-package.js";
export { snapshotUrl, urlToFixtureName } from "./snapshot.js";
export type { SnapshotUrlOptions, SnapshotResult, SnapshotMeta } from "./snapshot.js";
export { resolveCapabilities, DEFAULT_CAPABILITIES } from "./capabilities.js";
export { parseTTL, validateTTL } from "./ttl.js";
export { stableSerialize } from "./serialize.js";
