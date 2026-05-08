#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateOpenApiSpec } from "./openapi.js";
import { matchPagePattern } from "./test-harness.js";
import type { SiteDefinition } from "./types.js";

interface FixtureEntry {
	fixture: string;
	url: string;
}

const SITES_DIR = resolve(process.cwd(), "sites");

function green(text: string): string {
	return `\x1b[32m${text}\x1b[0m`;
}
function red(text: string): string {
	return `\x1b[31m${text}\x1b[0m`;
}
function dim(text: string): string {
	return `\x1b[2m${text}\x1b[0m`;
}

function discoverSiteDirs(): { name: string; path: string }[] {
	if (!existsSync(SITES_DIR)) return [];
	return readdirSync(SITES_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "node_modules")
		.map((d) => ({ name: d.name, path: resolve(SITES_DIR, d.name) }))
		.filter(({ path }) => existsSync(resolve(path, "index.ts")));
}

async function loadSite(sitePath: string): Promise<SiteDefinition> {
	// Try loading built JS first, fall back to TS via tsx/vitest loader
	const jsPath = resolve(sitePath, "dist", "index.js");
	const tsPath = resolve(sitePath, "index.ts");
	const modulePath = existsSync(jsPath) ? jsPath : tsPath;
	const mod = await import(pathToFileURL(modulePath).href);
	return mod.default;
}

// --- check command ---

interface CheckResult {
	label: string;
	ok: boolean;
	detail?: string;
}

async function checkSite(sitePath: string): Promise<{ name: string; results: CheckResult[] }> {
	const results: CheckResult[] = [];
	const siteName = basename(sitePath);

	let site: SiteDefinition;
	try {
		site = await loadSite(sitePath);
		results.push({ label: "site definition valid", ok: true });
	} catch (err) {
		results.push({ label: "site definition valid", ok: false, detail: String(err) });
		return { name: siteName, results };
	}

	// Site identity + origins
	const idOk = typeof site.site?.id === "string" && site.site.id.length > 0;
	const displayOk = typeof site.site?.displayName === "string" && site.site.displayName.length > 0;
	const originsOk =
		Array.isArray(site.origins) &&
		site.origins.length > 0 &&
		site.origins.every(
			(o) => typeof o.hostname === "string" && o.hostname.length > 0 && !o.hostname.includes("://"),
		);
	results.push({ label: "site identity + origins", ok: idOk && displayOk && originsOk });

	// Rate limit
	const rlOk = site.rateLimit.maxConcurrent > 0 && site.rateLimit.requestsPerSecond > 0;
	results.push({ label: "rate limit config", ok: rlOk });

	// Resources
	const resourceNames = Object.keys(site.resources);
	results.push({
		label: `${resourceNames.length} resource(s) (${resourceNames.join(", ")})`,
		ok: resourceNames.length > 0,
	});

	for (const [rName, resource] of Object.entries(site.resources)) {
		const ttl = resource.ttl;
		const ttlShape =
			typeof ttl === "object" &&
			typeof ttl.default === "string" &&
			typeof ttl.min === "string" &&
			typeof ttl.max === "string";
		if (!ttlShape) {
			results.push({
				label: `resource "${rName}" ttl shape`,
				ok: false,
				detail: "expected { default, min, max } strings",
			});
			continue;
		}
		const re = /^\d+[smhd]$/;
		if (!(re.test(ttl.default) && re.test(ttl.min) && re.test(ttl.max))) {
			results.push({
				label: `resource "${rName}" ttl format`,
				ok: false,
				detail: `each TTL must match /^\\d+[smhd]$/ (got default="${ttl.default}", min="${ttl.min}", max="${ttl.max}")`,
			});
		}
	}

	// Pages
	const pageEntries = Object.entries(site.pages);
	results.push({
		label: `${pageEntries.length} page(s) (${pageEntries.map(([k]) => k).join(", ")})`,
		ok: pageEntries.length > 0,
	});

	// Examples + pattern matching
	let totalExamples = 0;
	let allExamplesMatch = true;
	for (const [pattern, page] of pageEntries) {
		if (page.examples.length === 0) {
			results.push({ label: `page "${pattern}" examples`, ok: false, detail: "no examples" });
			allExamplesMatch = false;
			continue;
		}
		totalExamples += page.examples.length;
		for (const url of page.examples) {
			const match = matchPagePattern(site, url);
			if (!match || match.pageKey !== pattern) {
				allExamplesMatch = false;
				results.push({
					label: `example "${url}" matches "${pattern}"`,
					ok: false,
					detail: match ? `matched "${match.pageKey}" instead` : "no match",
				});
			}
		}

		// Check provides references
		for (const rName of page.provides) {
			if (!site.resources[rName]) {
				results.push({
					label: `page "${pattern}" provides "${rName}"`,
					ok: false,
					detail: "resource not defined",
				});
			}
		}
	}
	if (allExamplesMatch) {
		results.push({ label: `${totalExamples} example URL(s), all match patterns`, ok: true });
	}

	// normalizeUrl idempotency
	if (site.normalizeUrl) {
		const allExamples = Object.values(site.pages).flatMap((p) => p.examples);
		let idempotent = true;
		for (const url of allExamples) {
			const once = site.normalizeUrl(url);
			const twice = site.normalizeUrl(once);
			if (once !== twice) {
				idempotent = false;
				results.push({
					label: "normalizeUrl idempotent",
					ok: false,
					detail: `"${url}": once="${once}" twice="${twice}"`,
				});
				break;
			}
		}
		if (idempotent) {
			results.push({ label: "normalizeUrl is idempotent", ok: true });
		}
	}

	// Fixtures
	const fixturesJsonPath = resolve(sitePath, "fixtures.json");
	const fixturesDir = resolve(sitePath, "fixtures");

	if (!existsSync(fixturesJsonPath)) {
		results.push({ label: "fixtures.json", ok: false, detail: "missing" });
	} else if (!existsSync(fixturesDir)) {
		results.push({ label: "fixtures/ directory", ok: false, detail: "missing" });
	} else {
		const manifest: Record<string, FixtureEntry[]> = JSON.parse(
			readFileSync(fixturesJsonPath, "utf-8"),
		);
		let allCovered = true;
		let allExist = true;

		for (const pattern of Object.keys(site.pages)) {
			if (!manifest[pattern] || manifest[pattern].length === 0) {
				allCovered = false;
				results.push({
					label: `fixtures.json covers "${pattern}"`,
					ok: false,
					detail: "no entries",
				});
			}
		}

		for (const [, entries] of Object.entries(manifest)) {
			for (const entry of entries) {
				if (!existsSync(resolve(fixturesDir, entry.fixture))) {
					allExist = false;
					results.push({
						label: `fixture "${entry.fixture}" exists`,
						ok: false,
						detail: "file missing",
					});
				}
			}
		}

		if (allCovered && allExist) {
			results.push({ label: "fixtures.json covers all pages, all files exist", ok: true });
		}
	}

	// Test file
	const hasTestFile = existsSync(resolve(sitePath, "index.test.ts"));
	results.push({ label: "index.test.ts exists", ok: hasTestFile });

	return { name: siteName, results };
}

async function runCheck(domain?: string): Promise<void> {
	const dirs = discoverSiteDirs();
	const targets = domain ? dirs.filter((d) => d.name === domain) : dirs;

	if (targets.length === 0) {
		console.error(domain ? `Site "${domain}" not found in sites/` : "No sites found in sites/");
		process.exit(1);
	}

	let allPassed = true;

	for (const { name, path } of targets) {
		const { results } = await checkSite(path);
		const passed = results.every((r) => r.ok);
		if (!passed) allPassed = false;

		console.log(passed ? green(`✓ ${name}`) : red(`✗ ${name}`));
		for (const r of results) {
			const icon = r.ok ? green("✓") : red("✗");
			const detail = r.detail ? dim(` (${r.detail})`) : "";
			console.log(`  ${icon} ${r.label}${detail}`);
		}
	}

	if (!allPassed) process.exit(1);
}

// --- fetch-fixtures command ---

function urlToFixtureName(url: string): string {
	const u = new URL(url);
	// Combine path and query into a slug
	let slug = u.pathname.replace(/^\/+/, "").replace(/\//g, "-");
	if (u.search) {
		const params = new URLSearchParams(u.search);
		const paramParts: string[] = [];
		for (const [key, value] of params) {
			paramParts.push(`${key}-${value}`);
		}
		if (paramParts.length > 0) {
			slug = slug ? `${slug}-${paramParts.join("-")}` : paramParts.join("-");
		}
	}
	// Clean up and add extension
	slug = slug
		.replace(/[^a-zA-Z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return `${slug || "index"}.html`;
}

async function runFetchFixtures(domain?: string): Promise<void> {
	const dirs = discoverSiteDirs();
	const targets = domain ? dirs.filter((d) => d.name === domain) : dirs;

	if (targets.length === 0) {
		console.error(domain ? `Site "${domain}" not found in sites/` : "No sites found in sites/");
		process.exit(1);
	}

	for (const { name, path } of targets) {
		console.log(`\n${name}`);

		let site: SiteDefinition;
		try {
			site = await loadSite(path);
		} catch (err) {
			console.error(red(`  Failed to load site: ${err}`));
			continue;
		}

		const fixturesDir = resolve(path, "fixtures");
		if (!existsSync(fixturesDir)) {
			mkdirSync(fixturesDir, { recursive: true });
		}

		const manifest: Record<string, FixtureEntry[]> = {};

		for (const [pattern, page] of Object.entries(site.pages)) {
			manifest[pattern] = [];

			for (const exampleUrl of page.examples) {
				const fixtureName = urlToFixtureName(exampleUrl);
				const fixturePath = resolve(fixturesDir, fixtureName);

				// Skip if fixture already exists
				if (existsSync(fixturePath)) {
					console.log(dim(`  Skipping ${exampleUrl} → ${fixtureName} (exists)`));
					manifest[pattern].push({ fixture: fixtureName, url: exampleUrl });
					continue;
				}

				console.log(`  Fetching ${exampleUrl}...`);
				try {
					const resp = await fetch(exampleUrl, {
						headers: {
							"User-Agent":
								"Mozilla/5.0 (compatible; sitely fixture fetcher; +https://github.com/nicholasgriffintn/wapi)",
						},
					});
					if (!resp.ok) {
						console.error(red(`    HTTP ${resp.status}`));
						continue;
					}
					const html = await resp.text();
					writeFileSync(fixturePath, html, "utf-8");
					const sizeKb = Math.round(html.length / 1024);
					console.log(green(`    → saved ${fixtureName} (${sizeKb}KB)`));
					manifest[pattern].push({ fixture: fixtureName, url: exampleUrl });
				} catch (err) {
					console.error(red(`    Failed: ${err}`));
				}
			}
		}

		// Write fixtures.json
		const manifestPath = resolve(path, "fixtures.json");
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf-8");
		console.log(green("  → updated fixtures.json"));
	}
}

// --- init command ---

function validateDomain(domain: string): void {
	if (!domain) {
		console.error("Error: domain is required.\n");
		console.error("Usage: sitely init <domain>");
		process.exit(1);
	}
	if (domain.includes("://")) {
		console.error(`Error: domain should not include a protocol (got "${domain}").`);
		console.error('Use just the domain, e.g. "example.com"');
		process.exit(1);
	}
	if (!domain.includes(".")) {
		console.error(`Error: "${domain}" doesn't look like a valid domain (missing dot).`);
		process.exit(1);
	}
}

function slugify(domain: string): string {
	return domain.replace(/[^a-z0-9.]/gi, "-").toLowerCase();
}

function runInit(domain: string): void {
	validateDomain(domain);

	const rootDir = resolve(SITES_DIR, domain);
	if (existsSync(rootDir)) {
		console.error(`Error: directory already exists: sites/${domain}/`);
		process.exit(1);
	}

	mkdirSync(rootDir, { recursive: true });
	mkdirSync(join(rootDir, "fixtures"), { recursive: true });

	const slug = slugify(domain);
	const idGuess = slug.replace(/\..*/, "").replace(/-/g, "");
	const pkg = {
		name: `@sitely/site-${slug}`,
		private: true,
		version: "0.1.0",
		type: "module",
		scripts: {
			build: "tsc",
			typecheck: "tsc --noEmit",
			test: "vitest run",
		},
		dependencies: {
			"@sitely/framework": "workspace:*",
			"@sitely/schemas": "workspace:*",
		},
		devDependencies: {
			typescript: "^5.7.3",
			vitest: "^3.0.4",
		},
	};
	writeFileSync(join(rootDir, "package.json"), `${JSON.stringify(pkg, null, "\t")}\n`);

	const tsconfig = {
		extends: "../../tsconfig.json",
		compilerOptions: { outDir: "./dist", rootDir: ".", lib: ["ES2022", "DOM"] },
		include: ["./**/*.ts"],
		exclude: ["node_modules", "dist", "**/*.test.ts"],
	};
	writeFileSync(join(rootDir, "tsconfig.json"), `${JSON.stringify(tsconfig, null, "\t")}\n`);

	writeFileSync(
		join(rootDir, "index.ts"),
		`import { defineSite } from "@sitely/framework";
import { WebPage } from "@sitely/schemas";

export default defineSite({
	site: {
		id: "${idGuess}", // TODO: pick a stable, scoped id (lowercase, no dots)
		displayName: "${domain}", // TODO: human-readable name
	},

	origins: [{ hostname: "${domain}" }],

	normalizeUrl: (url) => {
		const u = new URL(url);
		u.hash = "";
		return u.toString();
	},

	rateLimit: {
		maxConcurrent: 2,
		requestsPerSecond: 1,
	},

	schemas: { WebPage },

	resources: {
		// TODO: Define your resources
		page: {
			schema: "WebPage",
			params: {},
			resolve: () => "/",
			ttl: { default: "1h", min: "1m", max: "24h" },
		},
	},

	pages: {
		// TODO: Define your page patterns and extraction logic
		"/": {
			provides: ["page"],
			examples: [
				"https://${domain}/", // TODO: Add real example URLs
			],

			validate: (ctx) => {
				return ctx.status === 200;
			},

			extract: async (ctx) => ({
				page: {
					name: ctx.$("title")?.text()?.trim() ?? "",
				},
			}),
		},
	},
});
`,
	);

	writeFileSync(
		join(rootDir, "index.test.ts"),
		`import { createFixtureLoader, describePageExtraction } from "@sitely/framework/testing";
import { describe } from "vitest";
import site from "./index.js";

const loadFixture = createFixtureLoader(import.meta.url);

describe("${domain}", () => {
	// TODO: Add fixtures and uncomment:
	// describePageExtraction({
	// 	site,
	// 	pageKey: "/",
	// 	loadFixture,
	// 	fixtures: [{ fixture: "index.html", url: "https://${domain}/" }],
	// });
});
`,
	);

	writeFileSync(join(rootDir, "fixtures.json"), "{}\n");
	writeFileSync(join(rootDir, "fixtures", ".gitkeep"), "");

	console.log(green(`\nCreated site package: sites/${domain}/\n`));
	console.log("Files:");
	console.log(`  sites/${domain}/package.json`);
	console.log(`  sites/${domain}/tsconfig.json`);
	console.log(`  sites/${domain}/index.ts`);
	console.log(`  sites/${domain}/index.test.ts`);
	console.log(`  sites/${domain}/fixtures.json`);
	console.log(`  sites/${domain}/fixtures/.gitkeep`);
	console.log("\nNext steps:");
	console.log(`  1. Edit sites/${domain}/index.ts to define your pages and extraction logic`);
	console.log("  2. Run `pnpm install` to link the new workspace package");
	console.log(`  3. Run \`pnpm sitely fetch-fixtures ${domain}\` to download fixture HTML`);
}

// --- openapi command ---

async function runOpenApi(cmdArgs: string[]): Promise<void> {
	let outputFile: string | null = null;

	for (let i = 0; i < cmdArgs.length; i++) {
		if (cmdArgs[i] === "--output" && i + 1 < cmdArgs.length) {
			outputFile = cmdArgs[++i]!;
		}
	}

	const dirs = discoverSiteDirs();
	if (dirs.length === 0) {
		console.error("No site directories found in sites/");
		process.exit(1);
	}

	const sites: SiteDefinition[] = [];
	for (const { name, path } of dirs) {
		try {
			const site = await loadSite(path);
			sites.push(site);
		} catch {
			console.error(`Warning: could not load site from ${name}`);
		}
	}

	if (sites.length === 0) {
		console.error("No valid site definitions found. Did you run 'pnpm build' first?");
		process.exit(1);
	}

	const spec = generateOpenApiSpec(sites);
	const json = JSON.stringify(spec, null, "\t");

	if (outputFile) {
		await writeFile(outputFile, json, "utf-8");
		console.error(`OpenAPI spec written to ${outputFile} (${sites.length} site(s))`);
	} else {
		console.log(json);
	}
}

// --- main ---

const [command, ...args] = process.argv.slice(2);

switch (command) {
	case "check":
		await runCheck(args[0]);
		break;
	case "fetch-fixtures":
		await runFetchFixtures(args[0]);
		break;
	case "init":
		runInit(args[0] ?? "");
		break;
	case "openapi":
		await runOpenApi(args);
		break;
	default:
		console.log(`Usage:
  sitely init <domain>            Scaffold a new site package
  sitely check [domain]           Validate site definitions
  sitely fetch-fixtures [domain]  Fetch example URLs as HTML fixtures
  sitely openapi [--output file]  Generate OpenAPI 3.1 spec`);
		if (command) {
			console.error(`\nUnknown command: ${command}`);
			process.exit(1);
		}
}
