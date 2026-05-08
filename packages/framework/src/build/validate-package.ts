import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SiteDefinition } from "../types.js";
import { type ValidationError, validateSite } from "./validate.js";

export interface ValidatePackageOptions {
	/** Absolute path to the package root (containing package.json + src/index.ts). */
	packageRoot: string;
}

export interface ValidatePackageResult {
	ok: boolean;
	errors: ValidationError[];
	site?: SiteDefinition;
}

/**
 * Run fast static validation against a site package — no fixture execution,
 * no schema emission, no manifest write.
 *
 * Per atlas §7: this is the cheap subset of `buildPackage` validations.
 * Watch-mode-friendly because it only requires loading the SiteDefinition
 * and running the in-memory checks.
 *
 * Use this when authoring a site def to get fast feedback without paying
 * the cost of full builds.
 */
export async function validatePackage(opts: ValidatePackageOptions): Promise<ValidatePackageResult> {
	const packageRoot = resolve(opts.packageRoot);

	const pkgJsonPath = join(packageRoot, "package.json");
	if (!existsSync(pkgJsonPath)) {
		return {
			ok: false,
			errors: [{ kind: "missing-site-id", message: `package.json not found at ${pkgJsonPath}` }],
		};
	}
	// Read package.json to surface any name/version issues early; not strictly
	// required for validation but a missing package.json is also a hard fail.
	JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

	const site = await loadSiteDefinition(packageRoot);
	if (!site) {
		return {
			ok: false,
			errors: [
				{
					kind: "missing-site-id",
					message: `No site definition found in ${packageRoot}/dist/index.js or ${packageRoot}/index.ts`,
				},
			],
		};
	}

	const errors = validateSite(site);
	return { ok: errors.length === 0, errors, site };
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
