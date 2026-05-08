import type { PageDriver } from "@wapi/page";

/**
 * Extract and parse all JSON-LD blocks from a page.
 *
 * @remarks
 * Handles plain objects, arrays, and `@graph` containers. Invalid JSON blocks
 * are silently skipped.
 *
 * @param driver - The page driver to extract JSON-LD from.
 * @returns An array of parsed JSON-LD objects.
 */
export function extractJsonLd(driver: PageDriver): Record<string, unknown>[] {
	const results: Record<string, unknown>[] = [];
	const scripts = driver.$$('script[type="application/ld+json"]');

	for (const script of scripts) {
		const text = script.text().trim();
		if (!text) continue;

		try {
			const parsed = JSON.parse(text);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (item && typeof item === "object") {
						results.push(item as Record<string, unknown>);
					}
				}
			} else if (parsed && typeof parsed === "object") {
				// Handle @graph
				if ("@graph" in parsed && Array.isArray(parsed["@graph"])) {
					for (const item of parsed["@graph"]) {
						if (item && typeof item === "object") {
							results.push(item as Record<string, unknown>);
						}
					}
				} else {
					results.push(parsed as Record<string, unknown>);
				}
			}
		} catch {
			// Skip invalid JSON-LD blocks
		}
	}

	return results;
}

/**
 * Filter JSON-LD objects by `@type`.
 *
 * @remarks
 * Handles string and array `@type` values, as well as prefixed types
 * like `"schema:Article"` and `"https://schema.org/Article"`.
 *
 * @param items - The JSON-LD objects to filter.
 * @param type - The schema.org type name to match (e.g. `"Article"`).
 * @returns Matching objects.
 */
export function filterJsonLdByType(
	items: Record<string, unknown>[],
	type: string,
): Record<string, unknown>[] {
	return items.filter((item) => {
		const itemType = item["@type"];
		if (typeof itemType === "string") {
			return itemType === type || itemType === `schema:${type}` || itemType.endsWith(`/${type}`);
		}
		if (Array.isArray(itemType)) {
			return itemType.some(
				(t) =>
					t === type || t === `schema:${type}` || (typeof t === "string" && t.endsWith(`/${type}`)),
			);
		}
		return false;
	});
}
