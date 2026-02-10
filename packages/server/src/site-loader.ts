import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SiteDefinition } from "@wapi/framework";

/**
 * Load site definitions from a directory.
 * Expects structure: sitesDir/<domain>/index.ts (or compiled dist/index.js).
 * Each site module must have a default export that is a SiteDefinition.
 */
export async function loadSitesFromDisk(sitesDir: string): Promise<SiteDefinition[]> {
	const sites: SiteDefinition[] = [];

	let entries: string[];
	try {
		entries = await readdir(sitesDir);
	} catch {
		console.warn(`Sites directory not found: ${sitesDir}`);
		return sites;
	}

	for (const entry of entries) {
		const siteDir = join(sitesDir, entry);

		// Try compiled JS first (dist/index.js), then source (index.ts via tsx/node)
		const candidates = [
			join(siteDir, "dist", "index.js"),
			join(siteDir, "index.js"),
		];

		let loaded = false;
		for (const candidate of candidates) {
			try {
				const fileUrl = pathToFileURL(candidate).href;
				const mod = await import(fileUrl);
				const site = mod.default as SiteDefinition;
				if (site?.domain) {
					sites.push(site);
					loaded = true;
					break;
				}
			} catch {
				// Try next candidate
			}
		}

		if (!loaded) {
			console.warn(`  Could not load site definition from ${siteDir}`);
		}
	}

	return sites;
}
