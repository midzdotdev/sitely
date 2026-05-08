import type { SiteDefinition } from "./types.js";

/**
 * Resolve a site's declared origins into concrete hostnames.
 *
 * For each declared origin, if `templated: true` and the site has `locales`,
 * substitutes `{locale}` for each value in `locales.values`. Otherwise the
 * hostname is returned as-is.
 *
 * @param site - The site definition.
 * @param locale - If provided, only origins for this locale are returned.
 *                 Otherwise, all locale × origin combinations are returned.
 * @returns Array of `{ hostname, locale }` pairs. `locale` is `null` when the
 *          origin is not templated and the site has no locales declared.
 */
export function getActiveOrigins(
	site: SiteDefinition,
	locale?: string,
): Array<{ hostname: string; locale: string | null }> {
	const out: Array<{ hostname: string; locale: string | null }> = [];

	for (const origin of site.origins) {
		if (origin.templated && site.locales) {
			const localesToExpand = locale ? [locale] : site.locales.values;
			for (const loc of localesToExpand) {
				out.push({ hostname: origin.hostname.replaceAll("{locale}", loc), locale: loc });
			}
		} else {
			out.push({ hostname: origin.hostname, locale: site.locales?.default ?? null });
		}
	}

	return out;
}

/**
 * Resolve the primary hostname for a site at a given locale.
 *
 * Convenience wrapper around {@link getActiveOrigins} that returns the first
 * origin (resolved against the locale, defaulting to `locales.default`).
 * Useful for v1 server consumers that previously read `site.domain`.
 *
 * @param site - The site definition.
 * @param locale - Locale to use for `{locale}` substitution. Defaults to `locales.default`.
 * @returns The resolved hostname.
 */
export function getPrimaryHostname(site: SiteDefinition, locale?: string): string {
	const lookup = locale ?? site.locales?.default;
	const first = site.origins[0];
	if (!first) throw new Error(`Site "${site.site.id}" declares no origins`);
	if (first.templated && lookup) {
		return first.hostname.replaceAll("{locale}", lookup);
	}
	return first.hostname;
}

/**
 * Return all hostnames a site can be reached at (across all locales).
 *
 * This is the universe used for site registration / lookup by host.
 *
 * @param site - The site definition.
 * @returns Sorted, deduplicated array of hostnames.
 */
export function getAllHostnames(site: SiteDefinition): string[] {
	const set = new Set<string>();
	for (const { hostname } of getActiveOrigins(site)) {
		set.add(hostname);
	}
	return [...set].sort();
}
