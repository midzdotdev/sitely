import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A single fixture entry per atlas §10 layout:
 *   fixtures/<locale>/<name>.html
 *   fixtures/<locale>/<name>.expected.json   (optional — required for fixture-extraction check)
 *   fixtures/<locale>/<name>.meta.json       (optional — provides status/headers)
 *   fixtures/<locale>/<name>.error.html      (optional — error-path coverage)
 *   fixtures/<locale>/<name>.error.json      (optional — error-path coverage)
 *
 * `locale` is `null` when the fixture sits directly under `fixtures/` (single-locale sites)
 * or when the directory is the special `_` placeholder we use for unlocaled fixtures.
 */
export interface Fixture {
	name: string;
	locale: string | null;
	htmlPath: string;
	html: string;
	expected?: Record<string, unknown> | null;
	meta?: { url?: string; status?: number; headers?: Record<string, string> };
	isErrorFixture: boolean;
}

/**
 * Discover all fixtures in a package per atlas §10 layout.
 *
 * Walks `<packageRoot>/fixtures/` recursively. Each `<name>.html` (or
 * `<name>.error.html`) becomes a Fixture; sibling `.expected.json` /
 * `.meta.json` / `.error.json` are loaded if present.
 *
 * Returns the empty array for packages with no fixtures dir — callers
 * decide whether that's an error.
 */
export function discoverFixtures(packageRoot: string): Fixture[] {
	const fixturesRoot = join(packageRoot, "fixtures");
	if (!existsSync(fixturesRoot)) return [];

	const out: Fixture[] = [];
	const entries = readdirSync(fixturesRoot, { withFileTypes: true });

	// Direct .html files (single-locale sites).
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const fixture = loadIfHtml(fixturesRoot, entry.name, null);
		if (fixture) out.push(fixture);
	}

	// Locale subdirectories.
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		const locale = entry.name === "_" ? null : entry.name;
		const localeDir = join(fixturesRoot, entry.name);
		for (const file of readdirSync(localeDir, { withFileTypes: true })) {
			if (!file.isFile()) continue;
			const fixture = loadIfHtml(localeDir, file.name, locale);
			if (fixture) out.push(fixture);
		}
	}

	// Sort deterministically: by locale (null first), then by name, then errors after happy path.
	out.sort((a, b) => {
		const la = a.locale ?? "";
		const lb = b.locale ?? "";
		if (la !== lb) return la < lb ? -1 : 1;
		if (a.name !== b.name) return a.name < b.name ? -1 : 1;
		if (a.isErrorFixture !== b.isErrorFixture) return a.isErrorFixture ? 1 : -1;
		return 0;
	});

	return out;
}

function loadIfHtml(dir: string, file: string, locale: string | null): Fixture | null {
	if (!file.endsWith(".html")) return null;
	const isErrorFixture = file.endsWith(".error.html");
	const baseName = isErrorFixture ? file.slice(0, -".error.html".length) : file.slice(0, -".html".length);
	const htmlPath = resolve(join(dir, file));
	const html = readFileSync(htmlPath, "utf-8");

	const expectedSuffix = isErrorFixture ? ".error.json" : ".expected.json";
	const expectedPath = join(dir, `${baseName}${expectedSuffix}`);
	const metaPath = join(dir, `${baseName}.meta.json`);

	let expected: Record<string, unknown> | null = null;
	if (existsSync(expectedPath)) {
		try {
			expected = JSON.parse(readFileSync(expectedPath, "utf-8"));
		} catch {
			// Will surface as a check failure downstream; load empty so harness still runs.
		}
	}

	let meta: Fixture["meta"] | undefined;
	if (existsSync(metaPath)) {
		try {
			meta = JSON.parse(readFileSync(metaPath, "utf-8"));
		} catch {
			// Same — surface downstream.
		}
	}

	return { name: baseName, locale, htmlPath, html, expected, meta, isErrorFixture };
}
