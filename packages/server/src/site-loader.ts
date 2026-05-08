import { getAllHostnames, type SiteDefinition } from "@sitely/framework";
import type { Logger } from "pino";

/**
 * Registry of loaded site definitions, keyed by hostname.
 *
 * A site can be reachable at multiple hostnames (one per locale when
 * `locales.source === "host"`); each hostname maps back to the same site.
 */
const siteRegistry = new Map<string, SiteDefinition>();
const sitesById = new Map<string, SiteDefinition>();

/**
 * Register a site definition. Called at startup.
 *
 * Adds an entry per active hostname (locale-expanded if applicable) so the
 * server can route by `Host:` header or path-prefix lookup.
 */
export function registerSite(site: SiteDefinition, logger?: Logger): void {
	const hostnames = getAllHostnames(site);
	for (const hostname of hostnames) {
		siteRegistry.set(hostname, site);
	}
	sitesById.set(site.site.id, site);
	logger?.info(
		{ siteId: site.site.id, hostnames },
		"Registered site definition",
	);
}

/**
 * Get a site definition by hostname (locale-expanded).
 */
export function getSite(hostname: string): SiteDefinition | undefined {
	return siteRegistry.get(hostname);
}

/**
 * Get a site definition by canonical id.
 */
export function getSiteById(id: string): SiteDefinition | undefined {
	return sitesById.get(id);
}

/**
 * Get all registered site definitions (unique by site.id).
 */
export function getAllSites(): SiteDefinition[] {
	return [...sitesById.values()];
}
