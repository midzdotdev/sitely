/**
 * Generates the Site Catalog page for VitePress documentation.
 *
 * Discovers all site directories under sites/, dynamically imports each
 * built site definition (from dist/), and writes docs/sites/index.md.
 *
 * Prerequisites: run `pnpm build` first so dist/ files exist.
 *
 * Usage: npx tsx scripts/generate-site-catalog.ts
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SITES_DIR = join(ROOT, "sites");
const OUTPUT_DIR = join(ROOT, "docs", "sites");
const OUTPUT_FILE = join(OUTPUT_DIR, "index.md");

interface ParamDef {
	type: "string" | "number";
	required: boolean;
	description: string;
}

interface ResourceDef {
	schema: string;
	params: Record<string, ParamDef>;
	resolve: (params: Record<string, string>) => string;
	ttl: string;
}

interface PageDef {
	provides: readonly string[];
	examples: readonly string[];
}

interface RateLimitConfig {
	maxConcurrent: number;
	requestsPerSecond: number;
}

interface SiteDefinition {
	name: string;
	domain: string;
	aliases?: readonly string[];
	rateLimit: RateLimitConfig;
	resources: Record<string, ResourceDef>;
	pages: Record<string, PageDef>;
}

async function discoverSites(): Promise<string[]> {
	const entries = readdirSync(SITES_DIR, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
}

async function loadSite(domain: string): Promise<SiteDefinition | null> {
	const distEntry = join(SITES_DIR, domain, "dist", "index.js");
	if (!existsSync(distEntry)) {
		console.warn(`  skipping ${domain}: no dist/index.js (run pnpm build first)`);
		return null;
	}
	const mod = await import(pathToFileURL(distEntry).href);
	return (mod.default ?? mod) as SiteDefinition;
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatParams(params: Record<string, ParamDef>): string {
	const entries = Object.entries(params);
	if (entries.length === 0) return "_(none)_";
	return entries
		.map(([name, p]) => {
			const req = p.required ? "required" : "optional";
			return `\`${name}\` (${p.type}, ${req})`;
		})
		.join(", ");
}

function generateSummaryTable(sites: SiteDefinition[]): string {
	const lines: string[] = [];
	lines.push("| Domain | Resources | Pages |");
	lines.push("|--------|-----------|-------|");
	for (const site of sites) {
		const resourceCount = Object.keys(site.resources).length;
		const pageCount = Object.keys(site.pages).length;
		const anchor = site.domain.replace(/\./g, "");
		lines.push(`| [${escapeCell(site.domain)}](#${anchor}) | ${resourceCount} | ${pageCount} |`);
	}
	return lines.join("\n");
}

function generateSiteSection(site: SiteDefinition): string {
	const lines: string[] = [];

	// Header
	lines.push(`## ${site.domain}`);
	lines.push("");
	lines.push(`**${site.name}**`);
	if (site.aliases && site.aliases.length > 0) {
		lines.push(`  Aliases: ${site.aliases.map((a) => `\`${a}\``).join(", ")}`);
	}
	lines.push("");

	// Resources table
	lines.push("### Resources");
	lines.push("");
	lines.push("| Name | Schema | TTL | Params |");
	lines.push("|------|--------|-----|--------|");
	for (const [name, res] of Object.entries(site.resources)) {
		lines.push(
			`| \`${name}\` | \`${escapeCell(res.schema)}\` | \`${res.ttl}\` | ${formatParams(res.params)} |`,
		);
	}
	lines.push("");

	// Pages table
	lines.push("### Pages");
	lines.push("");
	lines.push("| Pattern | Provides | Examples |");
	lines.push("|---------|----------|----------|");
	for (const [pattern, page] of Object.entries(site.pages)) {
		const provides = page.provides.map((p) => `\`${p}\``).join(", ");
		const examples =
			page.examples.length > 0
				? page.examples.map((e) => `[${escapeCell(e)}](${e})`).join("<br>")
				: "_(none)_";
		lines.push(`| \`${escapeCell(pattern)}\` | ${provides} | ${examples} |`);
	}
	lines.push("");

	// Example API call
	const firstResource = Object.entries(site.resources)[0];
	if (firstResource) {
		const [resourceName, resourceDef] = firstResource;
		const exampleParams: Record<string, string> = {};
		for (const [paramName, paramDef] of Object.entries(resourceDef.params)) {
			exampleParams[paramName] = paramDef.type === "number" ? "1" : `example-${paramName}`;
		}
		const queryString = Object.entries(exampleParams)
			.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
			.join("&");
		const queryPart = queryString ? `?${queryString}` : "";

		lines.push("### Example API Call");
		lines.push("");
		lines.push("```bash");
		lines.push(`curl http://localhost:3000/v1/sites/${site.domain}/${resourceName}${queryPart} \\`);
		lines.push('  -H "Authorization: Bearer wapi_sk_..."');
		lines.push("```");
		lines.push("");
	}

	// Rate limit info
	lines.push("### Rate Limits");
	lines.push("");
	lines.push(`- **Max concurrent requests:** ${site.rateLimit.maxConcurrent}`);
	lines.push(`- **Requests per second:** ${site.rateLimit.requestsPerSecond}`);
	lines.push("");

	return lines.join("\n");
}

async function main() {
	console.log("Generating site catalog...");

	const domains = await discoverSites();
	console.log(`Found ${domains.length} site(s): ${domains.join(", ")}`);

	const sites: SiteDefinition[] = [];
	for (const domain of domains) {
		const site = await loadSite(domain);
		if (site) {
			sites.push(site);
			console.log(`  loaded ${domain}: ${Object.keys(site.resources).length} resource(s)`);
		}
	}

	if (sites.length === 0) {
		console.error("No sites loaded. Did you run pnpm build first?");
		process.exit(1);
	}

	// Generate markdown
	const lines: string[] = [];

	// Frontmatter + auto-generated notice
	lines.push("<!-- This file is auto-generated. Do not edit manually. -->");
	lines.push("");
	lines.push("# Site Catalog");
	lines.push("");
	lines.push(
		"WAPI ships with community-maintained site definitions that know how to extract structured data from specific websites. Each site definition declares its resources, URL patterns, and extraction logic.",
	);
	lines.push("");
	lines.push(
		`> There are currently **${sites.length}** site definition(s) covering **${sites.reduce((n, s) => n + Object.keys(s.resources).length, 0)}** resource(s).`,
	);
	lines.push("");

	// Summary table
	lines.push("## Overview");
	lines.push("");
	lines.push(generateSummaryTable(sites));
	lines.push("");

	// Detailed sections
	for (const site of sites) {
		lines.push("---");
		lines.push("");
		lines.push(generateSiteSection(site));
	}

	const content = lines.join("\n");

	// Write output
	if (!existsSync(OUTPUT_DIR)) {
		mkdirSync(OUTPUT_DIR, { recursive: true });
	}
	writeFileSync(OUTPUT_FILE, content, "utf-8");
	console.log(`Wrote ${OUTPUT_FILE}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
