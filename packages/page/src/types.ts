/**
 * A wrapper around a single DOM element providing a uniform read interface
 * regardless of the underlying engine (Cheerio, JSDOM, Playwright).
 *
 * @remarks
 * When an element is not found, query methods return `null`. The exported
 * {@link NULL_ELEMENT} constant provides a null-object implementation where
 * every method returns a safe default (`""`, `null`, `[]`, or `false`),
 * which is useful for avoiding null checks when chaining.
 *
 * @example
 * ```ts
 * const title = page.$("h1.title");
 * if (title) {
 *   console.log(title.text());
 * }
 *
 * const items = page.$$("li.item");
 * const texts = items.map(el => el.text());
 * ```
 */
export interface PageElement {
	/**
	 * Query a single descendant matching the CSS selector.
	 * @param selector - A CSS selector string.
	 * @returns The first matching element, or `null` if none match.
	 */
	$(selector: string): PageElement | null;
	/**
	 * Query all descendants matching the CSS selector.
	 * @param selector - A CSS selector string.
	 * @returns An array of matching elements (empty if none match).
	 */
	$$(selector: string): PageElement[];
	/**
	 * Get the combined text content of this element and its descendants.
	 * @returns The text content, or `""` for null elements.
	 */
	text(): string;
	/**
	 * Get the inner HTML of this element.
	 * @returns The inner HTML markup, or `""` for null elements.
	 */
	html(): string;
	/**
	 * Get the value of an attribute.
	 * @param name - The attribute name (e.g. `"href"`, `"src"`).
	 * @returns The attribute value, or `null` if it doesn't exist.
	 */
	attr(name: string): string | null;
	/**
	 * Check whether this element matched a real DOM node.
	 * @returns `true` if this wraps a real element, `false` for {@link NULL_ELEMENT}.
	 */
	exists(): boolean;
	/**
	 * Get a `data-*` attribute value.
	 * @param key - The data key without the `data-` prefix (e.g. `"id"` for `data-id`).
	 * @returns The attribute value as a string, or `null` if not present.
	 */
	data(key: string): string | null;
	/**
	 * Get all CSS class names on this element.
	 * @returns Array of class name strings (empty if no classes).
	 */
	classes(): string[];
	/**
	 * Get the next sibling element.
	 * @returns The next sibling, or `null` if there is none.
	 */
	next(): PageElement | null;
	/**
	 * Get the previous sibling element.
	 * @returns The previous sibling, or `null` if there is none.
	 */
	prev(): PageElement | null;
	/**
	 * Get the parent element.
	 * @returns The parent element, or `null` if at the root.
	 */
	parent(): PageElement | null;
	/**
	 * Get all direct child elements.
	 * @returns Array of child elements (empty if none).
	 */
	children(): PageElement[];
	/**
	 * Get the first element in a collection, or this element if singular.
	 * @returns The first element.
	 */
	first(): PageElement;
}

/**
 * A read-only driver providing DOM query access to a fetched page.
 *
 * @remarks
 * Represents a fully fetched and parsed HTML page. The MVP ships with
 * {@link CheerioDriver} for fast static HTML parsing. Future drivers
 * (JSDOM, Playwright) will implement this same interface.
 */
export interface PageDriver {
	/**
	 * Query a single element matching the CSS selector.
	 * @param selector - A CSS selector string.
	 * @returns The first matching element, or `null` if none match.
	 */
	$(selector: string): PageElement | null;
	/**
	 * Query all elements matching the CSS selector.
	 * @param selector - A CSS selector string.
	 * @returns An array of matching elements (empty if none match).
	 */
	$$(selector: string): PageElement[];
	/** Get the page `<title>` text. */
	title(): string;
	/** Get the full HTML of the page. */
	html(): string;
	/** HTTP status code of the fetched page. */
	status: number;
	/** Response headers from the page fetch. */
	headers: Record<string, string>;
	/** The URL of the fetched page. */
	url: string;
}
