/**
 * Build-time manifest types — atlas spec §0.
 *
 * The manifest is the keystone primitive: a static, build-time JSON document
 * emitted alongside the package's runtime code. Every framework decision
 * routes through it — directory rendering, capability sandbox enforcement,
 * runner startup cross-checks, framework-version compatibility, manifest
 * integrity (must be byte-identical on regeneration).
 *
 * Authors do not write this. `buildPackage()` emits it from the SiteDefinition.
 */

export interface ManifestSite {
	id: string;
	displayName: string;
	homepage?: string;
}

export interface ManifestOrigin {
	hostname: string;
	templated?: boolean;
}

export interface ManifestLocales {
	source: "host" | "path" | "query";
	values: string[];
	default: string;
}

export interface ManifestParam {
	type: "string" | "number";
	required?: boolean;
	description?: string;
}

export interface ManifestTTL {
	default: string;
	min: string;
	max: string;
}

export interface ManifestResource {
	schemaRef: string;
	params: Record<string, ManifestParam>;
	ttl: ManifestTTL;
	providedBy: string[];
}

export interface ManifestPage {
	provides: string[];
	examples: string[];
	fixtures?: string[];
}

export interface ManifestSchema {
	$ref: string;
	schemaOrgType: string | null;
	schemaOrgVersion?: string;
}

export interface ManifestCapabilities {
	network: { egress: "site-only" | "any" | "none" };
	filesystem: "none" | "read-temp" | "read-write-temp";
	process: "none";
	timers: { maxWallMs: number };
	memory: { maxMb: number };
}

export interface ManifestFramework {
	minVersion?: string;
	maxVersion?: string;
}

export interface ManifestBuild {
	commit: string;
	builtAt: string;
	tool: string;
}

export interface Manifest {
	manifestVersion: "1";
	packageName: string;
	packageVersion: string;
	site: ManifestSite;
	origins: ManifestOrigin[];
	locales?: ManifestLocales;
	resources: Record<string, ManifestResource>;
	pages: Record<string, ManifestPage>;
	schemas: Record<string, ManifestSchema>;
	capabilities: ManifestCapabilities;
	framework: ManifestFramework;
	family?: {
		origins: Array<{ hostname: string; display?: string }>;
		structuralIdentityCheck: string;
	};
	build: ManifestBuild;
}
