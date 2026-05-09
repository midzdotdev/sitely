#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	buildPackage,
	snapshotUrl,
	validatePackage,
} from "./build/index.js";
import { generateOpenApiSpec } from "./openapi.js";
import { testPackage } from "./test-pkg/index.js";
import type { SiteDefinition } from "./types.js";

const CWD = process.cwd();
const SITES_DIR = resolve(CWD, "sites");
const PACKAGES_DIR = resolve(CWD, "packages");

// ── ANSI helpers ──────────────────────────────────────────────────

function green(s: string): string {
	return `\x1b[32m${s}\x1b[0m`;
}
function red(s: string): string {
	return `\x1b[31m${s}\x1b[0m`;
}
function dim(s: string): string {
	return `\x1b[2m${s}\x1b[0m`;
}

// ── Per-package commands ──────────────────────────────────────────

/**
 * Resolve the package root to operate on. Defaults to CWD; `--package <path>`
 * overrides. `--all` (paired with no `--package`) iterates over `sites/*`
 * for the monorepo case.
 */
function parsePackageArg(args: string[]): { all: boolean; packageRoot: string | null } {
	const all = args.includes("--all");
	const idx = args.indexOf("--package");
	if (idx >= 0 && idx + 1 < args.length) {
		return { all, packageRoot: resolve(args[idx + 1]) };
	}
	if (all) return { all: true, packageRoot: null };
	return { all: false, packageRoot: CWD };
}

function discoverSiteDirs(): { name: string; path: string }[] {
	const found: { name: string; path: string }[] = [];

	// Legacy: sites/<domain>/ — kept for non-canary sites that haven't
	// migrated to the atlas §10 packages/site-<id>/ layout yet.
	if (existsSync(SITES_DIR)) {
		for (const d of readdirSync(SITES_DIR, { withFileTypes: true })) {
			if (!d.isDirectory() || d.name.startsWith("_") || d.name === "node_modules") continue;
			const path = resolve(SITES_DIR, d.name);
			if (existsSync(resolve(path, "index.ts"))) found.push({ name: d.name, path });
		}
	}

	// Canonical: packages/site-<id>/ per atlas §10.
	if (existsSync(PACKAGES_DIR)) {
		for (const d of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
			if (!d.isDirectory() || !d.name.startsWith("site-")) continue;
			const path = resolve(PACKAGES_DIR, d.name);
			if (existsSync(resolve(path, "index.ts"))) found.push({ name: d.name, path });
		}
	}

	return found;
}

async function packagesToOperateOn(args: string[]): Promise<string[]> {
	const { all, packageRoot } = parsePackageArg(args);
	if (all) return discoverSiteDirs().map((d) => d.path);
	if (!packageRoot) return [];
	return [packageRoot];
}

// ── sitely build ──────────────────────────────────────────────────

async function runBuild(args: string[]): Promise<number> {
	const targets = await packagesToOperateOn(args);
	if (targets.length === 0) {
		console.error(red("No packages to build."));
		return 1;
	}
	let allOk = true;
	for (const root of targets) {
		const result = await buildPackage({ packageRoot: root });
		if (!result.ok) {
			allOk = false;
			console.error(red(`✗ build ${root}`));
			for (const err of result.errors) {
				console.error(red(`  - [${err.kind}] ${err.message}`));
			}
		} else {
			console.log(green(`✓ build ${root}`));
			console.log(dim(`  wrote ${result.writtenFiles?.length ?? 0} file(s)`));
		}
	}
	return allOk ? 0 : 1;
}

// ── sitely check / sitely validate (alias) ────────────────────────

async function runCheck(args: string[]): Promise<number> {
	const targets = await packagesToOperateOn(args);
	if (targets.length === 0) {
		console.error(red("No packages to check."));
		return 1;
	}
	let allOk = true;
	for (const root of targets) {
		const result = await validatePackage({ packageRoot: root });
		if (!result.ok) {
			allOk = false;
			console.error(red(`✗ check ${root}`));
			for (const err of result.errors) {
				console.error(red(`  - [${err.kind}] ${err.message}`));
			}
		} else {
			console.log(green(`✓ check ${root}`));
		}
	}
	return allOk ? 0 : 1;
}

// ── sitely test ───────────────────────────────────────────────────

async function runTest(args: string[]): Promise<number> {
	const targets = await packagesToOperateOn(args);
	if (targets.length === 0) {
		console.error(red("No packages to test."));
		return 1;
	}
	let allOk = true;
	for (const root of targets) {
		console.log(`\n${root}`);
		const result = await testPackage({ packageRoot: root });
		for (const r of result.results) {
			const icon = r.ok ? green("✓") : red("✗");
			console.log(`  ${icon} ${r.check} (${r.count} item${r.count === 1 ? "" : "s"})`);
			for (const f of r.failures) {
				const tag = [f.fixture, f.locale, f.page, f.resource].filter(Boolean).join("/");
				console.log(red(`      - ${tag ? `[${tag}] ` : ""}${f.message}`));
				if (f.detail && typeof f.detail === "string") {
					for (const line of f.detail.split("\n").slice(0, 20)) {
						console.log(dim(`        ${line}`));
					}
				}
			}
		}
		if (!result.ok) allOk = false;
	}
	return allOk ? 0 : 1;
}

// ── sitely snapshot <url> ─────────────────────────────────────────

async function runSnapshot(args: string[]): Promise<number> {
	const url = args.find((a) => !a.startsWith("--"));
	if (!url) {
		console.error("Usage: sitely snapshot <url> [--locale <l>] [--package <path>] [--name <slug>]");
		return 1;
	}
	const localeIdx = args.indexOf("--locale");
	const locale = localeIdx >= 0 && localeIdx + 1 < args.length ? args[localeIdx + 1] : null;
	const nameIdx = args.indexOf("--name");
	const name = nameIdx >= 0 && nameIdx + 1 < args.length ? args[nameIdx + 1] : undefined;
	const pkgIdx = args.indexOf("--package");
	const packageRoot = pkgIdx >= 0 && pkgIdx + 1 < args.length ? resolve(args[pkgIdx + 1]) : CWD;

	const result = await snapshotUrl({ url, packageRoot, locale, name });
	if (!result.ok) {
		console.error(red(`✗ snapshot ${url}: ${result.error ?? "unknown error"}`));
		return 1;
	}
	if (result.skipped) {
		console.log(dim(`= snapshot ${url} (already on disk)`));
	} else {
		console.log(green(`✓ snapshot ${url}`));
		console.log(dim(`  ${result.htmlPath}`));
		console.log(dim(`  ${result.metaPath}`));
	}
	return 0;
}

// ── sitely fetch-fixtures (legacy batch mode) ─────────────────────

interface FixtureManifestEntry {
	fixture: string;
	url: string;
}

async function loadSiteFromDir(sitePath: string): Promise<SiteDefinition> {
	const jsPath = resolve(sitePath, "dist", "index.js");
	const tsPath = resolve(sitePath, "index.ts");
	const modulePath = existsSync(jsPath) ? jsPath : tsPath;
	const mod = await import(pathToFileURL(modulePath).href);
	return mod.default;
}

async function runFetchFixtures(args: string[]): Promise<number> {
	const domain = args.find((a) => !a.startsWith("--"));
	const dirs = discoverSiteDirs();
	const targets = domain ? dirs.filter((d) => d.name === domain) : dirs;
	if (targets.length === 0) {
		console.error(domain ? `Site "${domain}" not found in sites/` : "No sites found in sites/");
		return 1;
	}
	for (const { name, path } of targets) {
		console.log(`\n${name}`);
		let site: SiteDefinition;
		try {
			site = await loadSiteFromDir(path);
		} catch (err) {
			console.error(red(`  Failed to load site: ${err}`));
			continue;
		}
		const fixturesDir = resolve(path, "fixtures");
		if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });
		const manifest: Record<string, FixtureManifestEntry[]> = {};
		for (const [pattern, page] of Object.entries(site.pages)) {
			manifest[pattern] = [];
			for (const exampleUrl of page.examples) {
				const localeFromHost = (() => {
					try {
						return new URL(exampleUrl).hostname.split(".")[0];
					} catch {
						return null;
					}
				})();
				const result = await snapshotUrl({
					url: exampleUrl,
					packageRoot: path,
					locale: site.locales?.source === "host" ? localeFromHost : null,
				});
				if (!result.ok) {
					console.error(red(`  ✗ ${exampleUrl}: ${result.error ?? "unknown"}`));
					continue;
				}
				if (result.skipped) {
					console.log(dim(`  = ${exampleUrl} (exists)`));
				} else {
					console.log(green(`  ✓ ${exampleUrl}`));
				}
				manifest[pattern].push({
					fixture: result.htmlPath ?? "",
					url: exampleUrl,
				});
			}
		}
		// Keep the legacy fixtures.json manifest for backwards compat with
		// the existing _validate.test.ts harness; will be deprecated when
		// community sites adopt atlas §10 layout fully.
		const manifestPath = resolve(path, "fixtures.json");
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf-8");
		console.log(green("  → updated fixtures.json (legacy)"));
	}
	return 0;
}

// ── sitely init <domain> ──────────────────────────────────────────

function validateDomain(domain: string): void {
	if (!domain) {
		console.error("Error: domain is required.\n");
		console.error("Usage: sitely init <domain>");
		process.exit(1);
	}
	if (domain.includes("://")) {
		console.error(`Error: domain should not include a protocol (got "${domain}").`);
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
		scripts: { build: "tsc", typecheck: "tsc --noEmit", test: "vitest run" },
		dependencies: {
			"@sitely/framework": "workspace:*",
			"@sitely/schemas": "workspace:*",
		},
		devDependencies: { typescript: "^5.7.3", vitest: "^3.0.4" },
	};
	writeFileSync(join(rootDir, "package.json"), `${JSON.stringify(pkg, null, "\t")}\n`);
	writeFileSync(
		join(rootDir, "tsconfig.json"),
		`${JSON.stringify(
			{
				extends: "../../tsconfig.json",
				compilerOptions: { outDir: "./dist", rootDir: ".", lib: ["ES2022", "DOM"] },
				include: ["./**/*.ts"],
				exclude: ["node_modules", "dist", "**/*.test.ts"],
			},
			null,
			"\t",
		)}\n`,
	);
	writeFileSync(
		join(rootDir, "index.ts"),
		`import { defineSite } from "@sitely/framework";
import { WebPage } from "@sitely/schemas";

export default defineSite({
	site: { id: "${idGuess}", displayName: "${domain}" },
	origins: [{ hostname: "${domain}" }],
	rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
	schemas: { WebPage },
	resources: {
		page: {
			schema: "WebPage",
			params: {},
			resolve: () => "/",
			ttl: { default: "1h", min: "1m", max: "24h" },
		},
	},
	pages: {
		"/": {
			provides: ["page"],
			examples: ["https://${domain}/"],
			validate: (ctx) => ctx.status === 200,
			extract: async (ctx) => ({
				page: { name: ctx.$("title")?.text()?.trim() ?? "" },
			}),
		},
	},
});
`,
	);
	writeFileSync(join(rootDir, "fixtures", ".gitkeep"), "");
	console.log(green(`\nCreated site package: sites/${domain}/`));
	console.log("\nNext steps:");
	console.log(`  cd sites/${domain}`);
	console.log("  pnpm install");
	console.log(`  sitely snapshot https://${domain}/`);
	console.log("  sitely build && sitely test");
}

// ── sitely openapi ────────────────────────────────────────────────

async function runOpenApi(args: string[]): Promise<number> {
	const outIdx = args.indexOf("--output");
	const outputFile = outIdx >= 0 && outIdx + 1 < args.length ? args[outIdx + 1] : null;
	const dirs = discoverSiteDirs();
	if (dirs.length === 0) {
		console.error("No site directories found in sites/");
		return 1;
	}
	const sites: SiteDefinition[] = [];
	for (const { name, path } of dirs) {
		try {
			sites.push(await loadSiteFromDir(path));
		} catch {
			console.error(`Warning: could not load site from ${name}`);
		}
	}
	if (sites.length === 0) {
		console.error("No valid site definitions found. Did you run 'pnpm build' first?");
		return 1;
	}
	const json = JSON.stringify(generateOpenApiSpec(sites), null, "\t");
	if (outputFile) {
		await writeFile(outputFile, json, "utf-8");
		console.error(`OpenAPI spec written to ${outputFile} (${sites.length} site(s))`);
	} else {
		console.log(json);
	}
	return 0;
}

// ── main ──────────────────────────────────────────────────────────

function printUsage(): void {
	console.log(`Usage:
  sitely build    [--package <path>] [--all]   Emit dist/manifest.json + dist/schemas/*.json
  sitely test     [--package <path>] [--all]   Run all 8 must-pass CI checks
  sitely check    [--package <path>] [--all]   Fast static validation (no fixture execution)
  sitely validate [--package <path>] [--all]   Alias for \`check\`
  sitely snapshot <url> [--locale <l>] [--name <slug>] [--package <path>]
                                               Fetch a URL and persist as a fixture
  sitely init <domain>                         Scaffold a new site package under sites/
  sitely fetch-fixtures [domain]               Bulk-fetch example URLs (legacy fixtures.json)
  sitely openapi [--output file]               Generate OpenAPI 3.1 spec for all sites/

Without --package or --all, per-package commands operate on the current working directory.`);
}

const [command, ...args] = process.argv.slice(2);

let exitCode = 0;
switch (command) {
	case "build":
		exitCode = await runBuild(args);
		break;
	case "test":
		exitCode = await runTest(args);
		break;
	case "check":
	case "validate":
		exitCode = await runCheck(args);
		break;
	case "snapshot":
		exitCode = await runSnapshot(args);
		break;
	case "fetch-fixtures":
		exitCode = await runFetchFixtures(args);
		break;
	case "init":
		runInit(args[0] ?? "");
		break;
	case "openapi":
		exitCode = await runOpenApi(args);
		break;
	default:
		printUsage();
		if (command) {
			console.error(red(`\nUnknown command: ${command}`));
			exitCode = 1;
		}
}

if (exitCode !== 0) process.exit(exitCode);
