// The read surface — the one synchronous way `extract`/`validate` read a settled DOM, plus the async
// interaction surface `prepare` drives. Declared here; implemented by @sitely/page (01) for both the
// static (Cheerio) and dynamic (Playwright/CDP) backends, so extraction code is backend-identical.
// (Spec: 00 · The read surface / PageController.)

/**
 * An element in a settled DOM snapshot. Read-only by design — no `.append`, no `.attr(name, value)`.
 * Descendant queries are `$`/`$$` (there is no `.find()`); `$` returns `null` for no-match (not a
 * null-object), so missing data stays explicit.
 */
export interface PageElement {
	/** First matching descendant, or `null`. */
	$(selector: string): PageElement | null;
	/** All matching descendants (a real array — use `.map`/`.filter`). */
	$$(selector: string): PageElement[];
	/** Trimmed text content; `""` when empty. */
	text(): string;
	/** Inner HTML. */
	html(): string;
	/** Attribute value; `null` when absent, `""` when present-but-empty. */
	attr(name: string): string | null;
	/** Reads attribute `data-<key>` verbatim; no case-mapping, no coercion. */
	data(key: string): string | null;
	classes(): string[];
	parent(): PageElement | null;
	children(): PageElement[];
	next(): PageElement | null;
	prev(): PageElement | null;
}

/** The document-level read surface plus response metadata extract sometimes needs. */
export interface PageDriver {
	/** First matching element in the document, or `null`. */
	$(selector: string): PageElement | null;
	/** All matching elements in the document. */
	$$(selector: string): PageElement[];
	title(): string;
	/** Full document HTML. */
	html(): string;
	/** Final URL after redirects / render. */
	readonly url: string;
	readonly status: number;
	readonly headers: Record<string, string>;
}

/**
 * The interaction surface for `prepare` (async, browser-only) — authors drive it to settle
 * interaction-gated content into the DOM BEFORE the snapshot (expand an accordion, scroll a lazy
 * section into view). A static backend has no interaction phase: every method throws
 * `UnsupportedInteractionError` (see 01).
 */
export interface PageController {
	click(selector: string): Promise<void>;
	scrollTo(selector: string): Promise<void>;
	scrollToBottom(): Promise<void>;
	waitForSelector(
		selector: string,
		opts?: { timeoutMs?: number; state?: "attached" | "visible" },
	): Promise<void>;
	waitForTimeout(ms: number): Promise<void>;
	/** Escape hatch: run JS in the page. */
	evaluate<T>(fn: (() => T) | string): Promise<T>;
}
