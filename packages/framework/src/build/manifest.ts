import { execSync } from "node:child_process";
import { schemaOrgMetadata, schemaOrgVersion } from "@sitely/schemas";
import type { SiteDefinition } from "../types.js";
import { resolveCapabilities } from "./capabilities.js";
import type { Manifest, ManifestResource, ManifestSchema } from "./manifest-types.js";

export interface BuildContext {
	/** Absolute path to the package root (containing the package.json + src/ + dist/). */
	packageRoot: string;
	/** Framework CLI tool string for the manifest's `build.tool` field (e.g. "sitely-cli@0.1.0"). */
	tool: string;
}

/**
 * Construct a full Manifest from a loaded SiteDefinition + build context.
 *
 * Determinism contract: this function MUST produce byte-identical output
 * (after stable serialization) when given the same SiteDefinition and the
 * same git HEAD. Sources of nondeterminism are deliberately excluded:
 * - `build.builtAt` uses the git committer ISO timestamp of HEAD, not Date.now().
 * - `build.commit` is the HEAD short sha.
 * - `build.tool` is a static string passed in by the caller.
 * - All record fields are emitted directly; sorting happens at serialization time.
 */
export function buildManifest(
	site: SiteDefinition,
	pkg: { name: string; version: string },
	ctx: BuildContext,
): Manifest {
	const capabilities = resolveCapabilities(site);

	// Resources: derive `providedBy` from `pages[*].provides`.
	const resources: Record<string, ManifestResource> = {};
	for (const [name, resource] of Object.entries(site.resources ?? {})) {
		const providedBy: string[] = [];
		for (const [pageKey, page] of Object.entries(site.pages ?? {})) {
			if (page.provides.includes(name)) providedBy.push(`page:${pageKey}`);
		}
		resources[name] = {
			schemaRef: resource.schema,
			params: resource.params,
			ttl: resource.ttl,
			providedBy,
		};
	}

	// Schemas: tag each declared schema with its schema.org type via the metadata
	// map exported by @sitely/schemas. Custom schemas (not in metadata) get
	// schemaOrgType: null per atlas §1 and require a custom-type display.
	const schemas: Record<string, ManifestSchema> = {};
	for (const name of Object.keys(site.schemas ?? {})) {
		const meta = (schemaOrgMetadata as Record<string, { schemaOrgType: string }>)[name];
		schemas[name] = {
			$ref: `./schemas/${name}.json`,
			schemaOrgType: meta?.schemaOrgType ?? null,
			schemaOrgVersion: meta ? schemaOrgVersion : undefined,
		};
	}

	// Pages: drop the function bodies, keep only manifest-relevant fields.
	const pages: Manifest["pages"] = {};
	for (const [key, page] of Object.entries(site.pages ?? {})) {
		pages[key] = {
			provides: page.provides,
			examples: page.examples,
			...(page.fixtures ? { fixtures: page.fixtures } : {}),
		};
	}

	const manifest: Manifest = {
		manifestVersion: "1",
		packageName: pkg.name,
		packageVersion: pkg.version,
		site: {
			id: site.site.id,
			displayName: site.site.displayName,
			...(site.site.homepage ? { homepage: site.site.homepage } : {}),
		},
		origins: site.origins.map((o) => ({
			hostname: o.hostname,
			...(o.templated ? { templated: true } : {}),
		})),
		...(site.locales ? { locales: site.locales } : {}),
		resources,
		pages,
		schemas,
		capabilities,
		framework: site.framework ?? {},
		...(site.family
			? {
					family: {
						origins: site.family.origins.map((o) => ({
							hostname: o.hostname,
							...(o.display ? { display: o.display } : {}),
						})),
						structuralIdentityCheck: site.family.structuralIdentityCheck,
					},
				}
			: {}),
		build: {
			commit: gitHeadShortSha(ctx.packageRoot),
			builtAt: gitHeadCommitterISO(ctx.packageRoot),
			tool: ctx.tool,
		},
	};

	return manifest;
}

/**
 * Get the short SHA of HEAD. Used as a stable, deterministic identifier for
 * the `build.commit` manifest field.
 *
 * Falls back to `"unknown"` outside a git checkout — the manifest is still
 * structurally valid; only the determinism self-test would notice.
 */
function gitHeadShortSha(cwd: string): string {
	try {
		return execSync("git rev-parse --short HEAD", { cwd, encoding: "utf-8" }).trim();
	} catch {
		return "unknown";
	}
}

/**
 * Get the committer ISO8601 timestamp of HEAD. This is what populates
 * `build.builtAt` — NOT `Date.now()`, because we need byte-identical
 * regeneration (atlas §0 "manifest integrity" check).
 *
 * Per the safety-net pattern from #0c0f10a0: every manifest field that
 * could otherwise drift across builds is pinned to a deterministic source.
 */
function gitHeadCommitterISO(cwd: string): string {
	try {
		return execSync("git show -s --format=%cI HEAD", { cwd, encoding: "utf-8" }).trim();
	} catch {
		return "1970-01-01T00:00:00+00:00";
	}
}
