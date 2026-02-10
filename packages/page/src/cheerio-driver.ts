import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { PageDriver, PageElement } from "./types.js";

/**
 * Wraps a raw DOM node into a PageElement.
 * Uses `unknown` for the element type to avoid depending on cheerio's internal
 * Element export — we cast when passing to the CheerioAPI callable.
 */
function wrapElement($: CheerioAPI, el: unknown): PageElement {
	const $el = $(el as Parameters<CheerioAPI>[0]);
	return {
		$(selector: string) {
			const found = $el.find(selector).first();
			return found.length ? wrapElement($, found[0]) : null;
		},
		$$(selector: string) {
			return $el
				.find(selector)
				.toArray()
				.map((e) => wrapElement($, e));
		},
		text() {
			return $el.text().trim();
		},
		html() {
			return $el.html() ?? "";
		},
		attr(name: string) {
			return $el.attr(name) ?? null;
		},
		exists() {
			return $el.length > 0;
		},
		data(key: string) {
			const v = $el.data(key);
			if (v == null) return null;
			return String(v);
		},
		classes() {
			const c = $el.attr("class");
			return c ? c.trim().split(/\s+/) : [];
		},
		next() {
			const n = $el.next();
			return n.length ? wrapElement($, n[0]) : null;
		},
		prev() {
			const p = $el.prev();
			return p.length ? wrapElement($, p[0]) : null;
		},
		parent() {
			const p = $el.parent();
			return p.length ? wrapElement($, p[0]) : null;
		},
		children() {
			return $el
				.children()
				.toArray()
				.map((e) => wrapElement($, e));
		},
		first() {
			return wrapElement($, $el.first()[0]);
		},
	};
}

export interface CheerioDriverOptions {
	html: string;
	url: string;
	status?: number;
	headers?: Record<string, string>;
}

/**
 * CheerioDriver — PageDriver backed by Cheerio for static HTML parsing.
 */
export function createCheerioDriver(opts: CheerioDriverOptions): PageDriver {
	const $ = cheerio.load(opts.html);

	return {
		$(selector: string) {
			const el = $(selector).first();
			return el.length ? wrapElement($, el[0]) : null;
		},
		$$(selector: string) {
			return $(selector)
				.toArray()
				.map((e) => wrapElement($, e));
		},
		title() {
			return $("title").text().trim();
		},
		html() {
			return $.html();
		},
		status: opts.status ?? 200,
		headers: opts.headers ?? {},
		url: opts.url,
	};
}
