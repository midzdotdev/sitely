/**
 * PageElement — wrapper around a single DOM element.
 * All drivers (Cheerio, JSDOM, Playwright) implement this interface.
 */
export interface PageElement {
	$(selector: string): PageElement | null;
	$$(selector: string): PageElement[];
	text(): string;
	html(): string;
	attr(name: string): string | null;
	exists(): boolean;
	data(key: string): string | null;
	classes(): string[];
	next(): PageElement | null;
	prev(): PageElement | null;
	parent(): PageElement | null;
	children(): PageElement[];
	first(): PageElement;
}

/**
 * PageDriver — read-only interface to a loaded page.
 * Used for static scraping (Cheerio, JSDOM).
 */
export interface PageDriver {
	$(selector: string): PageElement | null;
	$$(selector: string): PageElement[];
	title(): string;
	html(): string;
	status: number;
	headers: Record<string, string>;
	url: string;
}
