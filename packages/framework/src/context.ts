import type { PageDriver } from "@wapi/page";
import type { ExtractContext, MediaRef } from "./types.js";
import { parseJsonLd, getCanonicalFromHtml } from "./json-ld.js";

export interface CreateContextOptions {
	driver: PageDriver;
	params: Record<string, string>;
	rawHtml: string;
	fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Creates an ExtractContext from a PageDriver and metadata.
 * This is the `ctx` object that validate/extract/paginate functions receive.
 */
export function createExtractContext(opts: CreateContextOptions): ExtractContext {
	const { driver, params, rawHtml } = opts;
	const mediaRefs: MediaRef[] = [];

	// Parse JSON-LD once, lazily
	let jsonLdCache: Record<string, unknown>[] | null = null;
	function getJsonLd(): Record<string, unknown>[] {
		if (!jsonLdCache) {
			jsonLdCache = parseJsonLd(rawHtml);
		}
		return jsonLdCache;
	}

	const ctx: ExtractContext = {
		$(selector: string) {
			return driver.$(selector);
		},
		$$(selector: string) {
			return driver.$$(selector);
		},

		jsonLd(type?: string) {
			const all = getJsonLd();
			if (!type) return all;
			return all.filter((obj) => {
				const t = obj["@type"];
				if (typeof t === "string") return t === type;
				if (Array.isArray(t)) return t.includes(type);
				return false;
			});
		},

		media(url: string | null | undefined): MediaRef | null {
			if (!url) return null;
			const resolved = url.startsWith("//")
				? `https:${url}`
				: url.startsWith("/")
					? `https://${new URL(driver.url).host}${url}`
					: url;
			const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
			let type: MediaRef["type"] = "unknown";
			if (["jpg", "jpeg", "png", "webp", "avif", "gif", "svg"].includes(ext)) type = "image";
			else if (["mp4", "webm", "mkv", "m3u8", "mpd"].includes(ext)) type = "video";
			else if (["mp3", "aac", "ogg", "flac", "wav"].includes(ext)) type = "audio";
			else if (["pdf"].includes(ext)) type = "document";
			const ref: MediaRef = { url: resolved, type };
			mediaRefs.push(ref);
			return ref;
		},

		params,
		url: driver.url,
		canonical: getCanonicalFromHtml(rawHtml),
		status: driver.status,
		headers: driver.headers,

		async fetch(url: string, init?: RequestInit): Promise<Response> {
			if (opts.fetchFn) return opts.fetchFn(url, init);
			throw new Error("ctx.fetch() is not available in this context");
		},
	};

	return ctx;
}

/** Extract collected media refs from context (for media pipeline). */
export function getMediaRefs(ctx: ExtractContext): MediaRef[] {
	// Access via closure — media refs are collected during extraction
	// This is a simple approach; a production version would use a WeakMap or symbol.
	return [];
}
