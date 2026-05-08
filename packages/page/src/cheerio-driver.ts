import * as cheerio from "cheerio";
import type { PageDriver, PageElement } from "./types.js";

// biome-ignore lint/suspicious/noExplicitAny: internal cheerio node type
type CheerioNode = cheerio.Cheerio<any>;

/** A PageElement backed by a Cheerio selection. */
class CheerioElement implements PageElement {
	constructor(
		private readonly el: CheerioNode,
		private readonly api: cheerio.CheerioAPI,
	) {}

	$(selector: string): PageElement | null {
		const found = this.el.find(selector).first();
		if (found.length === 0) return null;
		return new CheerioElement(found, this.api);
	}

	$$(selector: string): PageElement[] {
		const found = this.el.find(selector);
		const result: PageElement[] = [];
		found.each((_, node) => {
			result.push(new CheerioElement(this.api(node), this.api));
		});
		return result;
	}

	text(): string {
		return this.el.text();
	}

	html(): string {
		return this.el.html() ?? "";
	}

	attr(name: string): string | null {
		return this.el.attr(name) ?? null;
	}

	exists(): boolean {
		return this.el.length > 0;
	}

	data(key: string): string | null {
		const val = this.el.data(key);
		return val != null ? String(val) : null;
	}

	classes(): string[] {
		const cls = this.el.attr("class");
		if (!cls) return [];
		return cls.split(/\s+/).filter(Boolean);
	}

	next(): PageElement | null {
		const n = this.el.next();
		if (n.length === 0) return null;
		return new CheerioElement(n, this.api);
	}

	prev(): PageElement | null {
		const p = this.el.prev();
		if (p.length === 0) return null;
		return new CheerioElement(p, this.api);
	}

	parent(): PageElement | null {
		const par = this.el.parent();
		if (par.length === 0) return null;
		return new CheerioElement(par, this.api);
	}

	children(): PageElement[] {
		const result: PageElement[] = [];
		this.el.children().each((_, node) => {
			result.push(new CheerioElement(this.api(node), this.api));
		});
		return result;
	}

	first(): PageElement {
		return this;
	}
}

/** Null-object implementation of PageElement for safe chaining. */
class NullElement implements PageElement {
	$(): PageElement | null {
		return null;
	}
	$$(): PageElement[] {
		return [];
	}
	text(): string {
		return "";
	}
	html(): string {
		return "";
	}
	attr(): string | null {
		return null;
	}
	exists(): boolean {
		return false;
	}
	data(): string | null {
		return null;
	}
	classes(): string[] {
		return [];
	}
	next(): PageElement | null {
		return null;
	}
	prev(): PageElement | null {
		return null;
	}
	parent(): PageElement | null {
		return null;
	}
	children(): PageElement[] {
		return [];
	}
	first(): PageElement {
		return this;
	}
}

/**
 * A singleton null-object {@link PageElement} that returns safe defaults for all operations.
 * Every query returns `null` or `[]`, text/html return `""`, and `exists()` returns `false`.
 *
 * Useful for avoiding null checks when chaining queries on elements that may not exist.
 */
export const NULL_ELEMENT: PageElement = new NullElement();

/** Options for constructing a {@link CheerioDriver}. */
export interface CheerioDriverOptions {
	/** The raw HTML string to parse. */
	rawHtml: string;
	/** The URL the HTML was fetched from (used for relative URL resolution). */
	url: string;
	/** HTTP status code of the response. Defaults to `200`. */
	status?: number;
	/** HTTP response headers. Defaults to `{}`. */
	headers?: Record<string, string>;
}

/**
 * {@link PageDriver} backed by Cheerio for fast static HTML parsing.
 *
 * @example
 * ```ts
 * import { CheerioDriver } from "@sitely/page";
 *
 * const driver = new CheerioDriver({
 *   rawHtml: "<html><body><h1>Hello</h1></body></html>",
 *   url: "https://example.com",
 * });
 * console.log(driver.$("h1")?.text()); // "Hello"
 * ```
 */
export class CheerioDriver implements PageDriver {
	private readonly api: cheerio.CheerioAPI;
	readonly status: number;
	readonly headers: Record<string, string>;
	readonly url: string;

	constructor(opts: CheerioDriverOptions) {
		this.api = cheerio.load(opts.rawHtml);
		this.url = opts.url;
		this.status = opts.status ?? 200;
		this.headers = opts.headers ?? {};
	}

	$(selector: string): PageElement | null {
		const found = this.api(selector).first();
		if (found.length === 0) return null;
		return new CheerioElement(found, this.api);
	}

	$$(selector: string): PageElement[] {
		const found = this.api(selector);
		const result: PageElement[] = [];
		found.each((_, node) => {
			result.push(new CheerioElement(this.api(node), this.api));
		});
		return result;
	}

	title(): string {
		return this.api("title").text();
	}

	html(): string {
		return this.api.html();
	}
}
