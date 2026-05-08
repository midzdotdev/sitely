import { getPrimaryHostname, type SiteDefinition } from "@sitely/framework";

/**
 * Server-side accessor helpers that bridge the v2 DSL to legacy server code.
 *
 * The v1 DSL had `site.domain` (single hostname) and `site.name` (display);
 * v2 has `site.origins[]` + `site.locales` and `site.site.displayName`.
 * These helpers preserve the v1 semantics for the server's request-routing
 * and logging code without touching the DSL contract.
 */

/**
 * Primary hostname for the site (for outbound URLs, cache keys, log fields).
 *
 * For locale-templated origins, returns the hostname for `locales.default`.
 * For literal origins, returns `origins[0].hostname`.
 */
export function siteDomain(site: SiteDefinition): string {
	return getPrimaryHostname(site);
}

/** Human-readable display name. */
export function siteName(site: SiteDefinition): string {
	return site.site.displayName;
}
