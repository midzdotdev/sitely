import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stableSerialize } from "./serialize.js";

const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (compatible; sitely fixture fetcher; +https://github.com/nicholasgriffintn/wapi)";

export interface SnapshotUrlOptions {
	/** The URL to snapshot. */
	url: string;
	/** Absolute path to the package root. Fixtures are written under `<packageRoot>/fixtures/<locale>/<name>.html` per atlas §10. */
	packageRoot: string;
	/**
	 * Locale subdirectory for the fixture. Use the locale value from
	 * `site.locales.values` for locale-templated origins; pass `null` for
	 * sites without a locales block (fixture goes directly under `fixtures/`).
	 */
	locale?: string | null;
	/**
	 * Optional override for the fixture filename (without extension). If omitted,
	 * derived from the URL path + query (e.g. `/wiki/TypeScript` → `wiki-typescript`).
	 */
	name?: string;
	/** Custom User-Agent header. Defaults to a sitely-branded string. */
	userAgent?: string;
	/** Skip the network fetch if the fixture file already exists. Default: `true`. */
	skipIfExists?: boolean;
}

export interface SnapshotMeta {
	url: string;
	status: number;
	headers: Record<string, string>;
	fetchedAt: string;
	contentLength: number;
}

export interface SnapshotResult {
	ok: boolean;
	skipped?: boolean;
	error?: string;
	htmlPath?: string;
	metaPath?: string;
	meta?: SnapshotMeta;
}

/**
 * Fetch a live URL and persist it as a deterministic-replay fixture.
 *
 * Writes:
 * - `fixtures/<locale>/<name>.html` — the raw HTML body
 * - `fixtures/<locale>/<name>.meta.json` — `{url, status, headers, fetchedAt, contentLength}`
 *
 * Per atlas §10: the canonical fixture layout. The sibling `.meta.json` lets
 * the test harness replay extractions deterministically (status, headers
 * propagated to `ExtractContext`).
 *
 * Notes:
 * - Idempotent in the common case via `skipIfExists` (default true).
 * - 4xx/5xx responses are still written — the harness uses the status to
 *   exercise error-path coverage (atlas §9 #6).
 */
export async function snapshotUrl(opts: SnapshotUrlOptions): Promise<SnapshotResult> {
	const packageRoot = resolve(opts.packageRoot);
	const localeSegment = opts.locale ?? "_";
	const filename = opts.name ?? urlToFixtureName(opts.url);
	const fixturesDir = join(packageRoot, "fixtures", localeSegment);
	const htmlPath = join(fixturesDir, `${filename}.html`);
	const metaPath = join(fixturesDir, `${filename}.meta.json`);

	if ((opts.skipIfExists ?? true) && existsSync(htmlPath) && existsSync(metaPath)) {
		return { ok: true, skipped: true, htmlPath, metaPath };
	}

	let resp: Response;
	try {
		resp = await fetch(opts.url, {
			headers: { "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT },
		});
	} catch (err) {
		return { ok: false, error: `fetch failed: ${err instanceof Error ? err.message : String(err)}` };
	}

	const html = await resp.text();
	const headers: Record<string, string> = {};
	resp.headers.forEach((value, key) => {
		headers[key] = value;
	});

	const meta: SnapshotMeta = {
		url: opts.url,
		status: resp.status,
		headers,
		fetchedAt: new Date().toISOString(),
		contentLength: html.length,
	};

	if (!existsSync(dirname(htmlPath))) mkdirSync(dirname(htmlPath), { recursive: true });
	writeFileSync(htmlPath, html, "utf-8");
	writeFileSync(metaPath, stableSerialize(meta), "utf-8");

	return { ok: true, htmlPath, metaPath, meta };
}

/**
 * Derive a fixture filename from a URL. Mirrors today's `fetch-fixtures`
 * naming so existing fixture files keep working.
 *
 * Examples:
 * - `https://en.wikipedia.org/wiki/TypeScript` → `wiki-typescript`
 * - `https://news.ycombinator.com/news?p=2` → `news-p-2`
 * - `https://example.com/` → `index`
 */
export function urlToFixtureName(url: string): string {
	const u = new URL(url);
	let slug = u.pathname.replace(/^\/+/, "").replace(/\//g, "-");
	if (u.search) {
		const params = new URLSearchParams(u.search);
		const parts: string[] = [];
		for (const [key, value] of params) {
			parts.push(`${key}-${value}`);
		}
		if (parts.length > 0) {
			slug = slug ? `${slug}-${parts.join("-")}` : parts.join("-");
		}
	}
	slug = slug
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || "index";
}
