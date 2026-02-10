import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { registerSite } from "./services/extract-service.js";
import { loadSitesFromDisk } from "./site-loader.js";

// Load site definitions from disk at startup
const sitesDir = process.env["SITES_DIR"] ?? new URL("../../../sites", import.meta.url).pathname;
const loaded = await loadSitesFromDisk(sitesDir);
for (const site of loaded) {
	registerSite(site);
	console.log(`  Loaded site: ${site.name} (${site.domain})`);
}
console.log(`Loaded ${loaded.length} site definition(s)`);

const port = Number(process.env["PORT"] ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
	console.log(`WAPI server listening on http://localhost:${info.port}`);
});
