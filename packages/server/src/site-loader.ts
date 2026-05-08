import type { SiteDefinition } from "@wapi/framework";
import type { Logger } from "pino";

/**
 * Registry of loaded site definitions, keyed by domain.
 */
const siteRegistry = new Map<string, SiteDefinition>();

/**
 * Register a site definition. Called at startup.
 */
export function registerSite(site: SiteDefinition, logger?: Logger): void {
	siteRegistry.set(site.domain, site);
	if (site.aliases) {
		for (const alias of site.aliases) {
			siteRegistry.set(alias, site);
		}
	}
	logger?.info({ domain: site.domain, aliases: site.aliases }, "Registered site definition");
}

/**
 * Get a site definition by domain.
 */
export function getSite(domain: string): SiteDefinition | undefined {
	return siteRegistry.get(domain);
}

/**
 * Get all registered site definitions (unique by domain, excluding aliases).
 */
export function getAllSites(): SiteDefinition[] {
	const seen = new Set<string>();
	const sites: SiteDefinition[] = [];
	for (const site of siteRegistry.values()) {
		if (!seen.has(site.domain)) {
			seen.add(site.domain);
			sites.push(site);
		}
	}
	return sites;
}
