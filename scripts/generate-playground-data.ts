import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const sitesDir = join(rootDir, "sites");
const outputDir = join(rootDir, "docs", "public");
const outputPath = join(outputDir, "playground-data.json");

interface FixtureEntry {
	name: string;
	url: string;
	result: Record<string, unknown>;
}

interface PageEntry {
	fixtures: FixtureEntry[];
}

interface SiteEntry {
	name: string;
	domain: string;
	pages: Record<string, PageEntry>;
}

interface PlaygroundData {
	sites: Record<string, SiteEntry>;
}

/**
 * Extract URL params from a URL given a page pattern.
 * e.g. pattern "/wiki/:title" + url "https://en.wikipedia.org/wiki/TypeScript"
 * yields { title: "TypeScript" }
 */
function extractParams(pattern: string, url: string): Record<string, string> {
	const u = new URL(url);
	const pathname = u.pathname;
	const patternParts = pattern.split("/");
	const pathParts = pathname.split("/");

	const params: Record<string, string> = {};

	for (let i = 0; i < patternParts.length; i++) {
		const part = patternParts[i]!;
		if (part.startsWith(":")) {
			const key = part.slice(1);
			params[key] = decodeURIComponent(pathParts[i] ?? "");
		}
	}

	// Also extract query params (e.g. ?id=123)
	for (const [key, value] of u.searchParams) {
		params[key] = value;
	}

	return params;
}

interface SiteDefinition {
	name: string;
	domain: string;
	pages: Record<
		string,
		{
			provides: readonly string[];
			examples: readonly string[];
			validate: (ctx: unknown) => boolean;
			extract: (ctx: unknown) => Promise<Record<string, unknown>>;
		}
	>;
}

async function loadSite(domain: string): Promise<SiteDefinition> {
	const siteDir = join(sitesDir, domain);
	const sitePath = pathToFileURL(join(siteDir, "dist", "index.js")).href;
	const siteModule = await import(sitePath);
	return siteModule.default as SiteDefinition;
}

async function loadFramework() {
	const frameworkPath = pathToFileURL(
		join(rootDir, "packages", "framework", "dist", "index.js"),
	).href;
	const framework = await import(frameworkPath);
	return {
		createTestContext: framework.createTestContext as (opts: {
			html: string;
			url: string;
			params?: Record<string, string>;
			status?: number;
		}) => unknown,
		testExtract: framework.testExtract as (
			site: SiteDefinition,
			pageKey: string,
			opts: { html: string; url: string; params?: Record<string, string>; validate?: boolean },
		) => Promise<Record<string, unknown>>,
	};
}

async function main() {
	const { testExtract, createTestContext } = await loadFramework();
	const data: PlaygroundData = { sites: {} };

	// Find all site directories
	const siteDirs = readdirSync(sitesDir).filter((name) => {
		const dir = join(sitesDir, name, "fixtures");
		return existsSync(dir) && !name.startsWith("_");
	});

	for (const domain of siteDirs) {
		console.log(`Processing site: ${domain}`);
		const site = await loadSite(domain);
		const fixtDir = join(sitesDir, domain, "fixtures");
		const fixtureFiles = readdirSync(fixtDir).filter((f) => f.endsWith(".html"));

		const siteEntry: SiteEntry = {
			name: site.name,
			domain: site.domain,
			pages: {},
		};

		for (const [pagePattern, pageDef] of Object.entries(site.pages)) {
			const pageEntry: PageEntry = { fixtures: [] };
			const exampleUrl = pageDef.examples[0] ?? `https://${domain}${pagePattern}`;

			for (const fixtureFile of fixtureFiles) {
				const html = readFileSync(join(fixtDir, fixtureFile), "utf-8");
				const params = extractParams(pagePattern, exampleUrl);

				// Check if this fixture validates against this page pattern
				try {
					const ctx = createTestContext({ html, url: exampleUrl, params });
					const isValid = pageDef.validate(ctx as never);
					if (!isValid) continue;
				} catch {
					continue;
				}

				// Extract data from the fixture
				try {
					const result = await testExtract(site, pagePattern, {
						html,
						url: exampleUrl,
						params,
						validate: false,
					});
					pageEntry.fixtures.push({
						name: fixtureFile,
						url: exampleUrl,
						result,
					});
					console.log(`  ${pagePattern} <- ${fixtureFile}`);
				} catch (err) {
					console.warn(`  ${pagePattern} <- ${fixtureFile} (extract failed: ${err})`);
				}
			}

			if (pageEntry.fixtures.length > 0) {
				siteEntry.pages[pagePattern] = pageEntry;
			}
		}

		if (Object.keys(siteEntry.pages).length > 0) {
			data.sites[domain] = siteEntry;
		}
	}

	// Write output
	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}
	writeFileSync(outputPath, JSON.stringify(data, null, "\t"));
	console.log(`\nWritten playground data to ${outputPath}`);
	const totalFixtures = Object.values(data.sites).reduce(
		(sum, s) => sum + Object.values(s.pages).reduce((ps, p) => ps + p.fixtures.length, 0),
		0,
	);
	console.log(`Sites: ${Object.keys(data.sites).length}, Total fixtures: ${totalFixtures}`);
}

main().catch((err) => {
	console.error("Failed to generate playground data:", err);
	process.exit(1);
});
