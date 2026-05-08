import type { PageDriver, PageElement } from "@sitely/page";
import { extractJsonLd, filterJsonLdByType } from "./json-ld.js";
import type { ExtractContext, MediaRef } from "./types.js";

/** Options for creating an {@link ExtractContext}. */
export interface CreateContextOptions {
	/** The page driver providing DOM access. */
	driver: PageDriver;
	/** Route params extracted from the URL pattern. */
	params: Record<string, string>;
	/** Active locale for this extraction, or `null` if the site has no locales. */
	locale?: string | null;
	/** Custom fetch function. Defaults to throwing (unavailable in test contexts). */
	fetchFn?: (url: string, opts?: RequestInit) => Promise<Response>;
}

/**
 * Create an {@link ExtractContext} from a {@link PageDriver} and route params.
 *
 * @remarks
 * In production, the server calls this with a live driver and a sandboxed fetch.
 * In tests, use {@link createTestContext} instead, which wraps this with a CheerioDriver.
 *
 * @param opts - The driver, params, and optional fetch function.
 * @returns A fully initialized ExtractContext.
 */
export function createExtractContext(opts: CreateContextOptions): ExtractContext {
	const { driver, params } = opts;
	const mediaRefs: MediaRef[] = [];
	let jsonLdCache: Record<string, unknown>[] | null = null;

	const ctx: ExtractContext = {
		$(selector: string): PageElement | null {
			return driver.$(selector);
		},

		$$(selector: string): PageElement[] {
			return driver.$$(selector);
		},

		jsonLd(type?: string): Record<string, unknown>[] {
			if (jsonLdCache === null) {
				jsonLdCache = extractJsonLd(driver);
			}
			if (type) {
				return filterJsonLdByType(jsonLdCache, type);
			}
			return jsonLdCache;
		},

		media(url: string | null | undefined): MediaRef | null {
			if (!url) return null;
			const resolved = resolveMediaUrl(url, driver.url);
			if (!resolved) return null;

			const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
			const type = classifyMediaType(ext);
			const ref: MediaRef = { url: resolved, type };
			mediaRefs.push(ref);
			return ref;
		},

		params,
		url: driver.url,
		locale: opts.locale ?? null,

		get canonical(): string | null {
			const link = driver.$('link[rel="canonical"]');
			return link?.attr("href") ?? null;
		},

		status: driver.status,
		headers: driver.headers,

		fetch: opts.fetchFn ?? defaultFetch,
	};

	return ctx;
}

/**
 * Get all media refs collected during extraction.
 * @internal
 */
export function getCollectedMedia(ctx: ExtractContext): MediaRef[] {
	// Access the closure's mediaRefs via a tagged property
	return (ctx as unknown as { __mediaRefs?: MediaRef[] }).__mediaRefs ?? [];
}

function resolveMediaUrl(url: string, baseUrl: string): string | null {
	try {
		if (url.startsWith("//")) return `https:${url}`;
		return new URL(url, baseUrl).toString();
	} catch {
		return null;
	}
}

function classifyMediaType(ext: string): MediaRef["type"] {
	const imageExts = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "svg"]);
	const videoExts = new Set(["mp4", "webm", "mkv", "m3u8", "mpd"]);
	const audioExts = new Set(["mp3", "aac", "ogg", "flac", "wav"]);
	const docExts = new Set(["pdf"]);

	if (imageExts.has(ext)) return "image";
	if (videoExts.has(ext)) return "video";
	if (audioExts.has(ext)) return "audio";
	if (docExts.has(ext)) return "document";
	return "unknown";
}

async function defaultFetch(): Promise<Response> {
	throw new Error(
		"ctx.fetch() is not available in this context. It is only available during live extraction.",
	);
}
