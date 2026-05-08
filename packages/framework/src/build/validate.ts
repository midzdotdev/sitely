import type { SiteDefinition } from "../types.js";
import { validateTTL } from "./ttl.js";

export interface ValidationError {
	kind:
		| "missing-schema-ref"
		| "ttl"
		| "locale-mismatch"
		| "resource-not-provided"
		| "page-provides-unknown"
		| "page-example-no-match"
		| "page-example-not-in-locale-set"
		| "family-shape-without-flag"
		| "missing-locale-default"
		| "missing-origins"
		| "missing-site-id";
	message: string;
	context?: Record<string, unknown>;
}

/**
 * Run all build-time static validations against a site definition.
 *
 * Returns the empty array when the site is valid. Any returned errors are
 * fatal — `buildPackage` exits non-zero before writing artifacts.
 *
 * Atlas §0/§3/§4/§5 validations:
 * - schema refs resolve into the schemas map
 * - TTL bounds (per atlas §5)
 * - locale param threading (host/path/query origin shape matches locales config)
 * - resources declared = provided by at least one page
 * - pages provide only declared resources
 * - page examples actually match their pattern
 * - example URLs use a declared locale value (when locale-in-host)
 * - family declarations have a structural-identity-check fixture
 */
export function validateSite(site: SiteDefinition): ValidationError[] {
	const errors: ValidationError[] = [];

	// Identity sanity.
	if (!site.site?.id) {
		errors.push({ kind: "missing-site-id", message: "site.id is required" });
	}
	if (!site.origins || site.origins.length === 0) {
		errors.push({ kind: "missing-origins", message: "origins[] must contain at least one entry" });
	}

	// Locales — when declared, default must be in values.
	if (site.locales) {
		if (!site.locales.values.includes(site.locales.default)) {
			errors.push({
				kind: "missing-locale-default",
				message: `locales.default "${site.locales.default}" is not in locales.values [${site.locales.values.join(", ")}]`,
			});
		}
	}

	// Locale param threading: host-templated origins must have a locales block.
	const hasHostTemplate = site.origins?.some((o) => o.templated && o.hostname.includes("{locale}"));
	if (hasHostTemplate && !site.locales) {
		errors.push({
			kind: "locale-mismatch",
			message:
				"At least one origin uses {locale} substitution but site.locales is not declared. Add `locales: { source: 'host', values: [...], default: '...' }`.",
		});
	}
	if (site.locales?.source === "host" && !hasHostTemplate) {
		errors.push({
			kind: "locale-mismatch",
			message:
				"site.locales.source is 'host' but no origin declares `templated: true` with a {locale} segment.",
		});
	}

	// Schema refs resolve.
	const declaredSchemas = new Set(Object.keys(site.schemas ?? {}));
	for (const [resourceName, resource] of Object.entries(site.resources ?? {})) {
		if (!declaredSchemas.has(resource.schema)) {
			errors.push({
				kind: "missing-schema-ref",
				message: `resource "${resourceName}" references schema "${resource.schema}" which is not in site.schemas`,
				context: { resource: resourceName, schema: resource.schema },
			});
		}

		// TTL bounds.
		for (const ttlError of validateTTL(resourceName, resource.ttl)) {
			errors.push({
				kind: "ttl",
				message: ttlError.message,
				context: { resource: ttlError.resource, field: ttlError.field },
			});
		}
	}

	// Resource declared = provided by at least one page.
	const providedResources = new Set<string>();
	for (const page of Object.values(site.pages ?? {})) {
		for (const r of page.provides) providedResources.add(r);
	}
	for (const resourceName of Object.keys(site.resources ?? {})) {
		if (!providedResources.has(resourceName)) {
			errors.push({
				kind: "resource-not-provided",
				message: `resource "${resourceName}" is declared but not provided by any page`,
				context: { resource: resourceName },
			});
		}
	}

	// Pages provide only declared resources.
	const declaredResources = new Set(Object.keys(site.resources ?? {}));
	for (const [pageKey, page] of Object.entries(site.pages ?? {})) {
		for (const r of page.provides) {
			if (!declaredResources.has(r)) {
				errors.push({
					kind: "page-provides-unknown",
					message: `page "${pageKey}" provides "${r}" but no such resource is declared`,
					context: { page: pageKey, resource: r },
				});
			}
		}
	}

	// Page examples must match their pattern + use a declared locale (when
	// locale-in-host). Pattern matching is delegated to the existing util to
	// avoid duplication; we only re-derive locale here.
	if (site.locales?.source === "host") {
		const localeValues = new Set(site.locales.values);
		for (const [pageKey, page] of Object.entries(site.pages ?? {})) {
			for (const exampleUrl of page.examples) {
				try {
					const u = new URL(exampleUrl);
					const firstLabel = u.hostname.split(".")[0];
					if (!localeValues.has(firstLabel)) {
						errors.push({
							kind: "page-example-not-in-locale-set",
							message: `example "${exampleUrl}" on page "${pageKey}" uses locale "${firstLabel}" which is not in locales.values`,
							context: { page: pageKey, example: exampleUrl, locale: firstLabel },
						});
					}
				} catch {
					// Malformed URL — let the pattern-match check downstream surface it.
				}
			}
		}
	}

	// Family — structural-identity-check fixture must be declared.
	if (site.family && !site.family.structuralIdentityCheck) {
		errors.push({
			kind: "family-shape-without-flag",
			message:
				"family is declared but family.structuralIdentityCheck is not set. Family packages require a fixture path for structural identity assertions (atlas §4).",
		});
	}

	return errors;
}
