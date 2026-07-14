import type { PageDef } from "./pages";

/**
 * A site assembled from page symbols. Flat config — no builder chain needed, because every symbol
 * already carries its own types. No resource registry / provider map is stored in v0 (nothing reads
 * one; `runExtraction` resolves by page name) — both are v1 seams the interface catalogue derives on
 * demand from the bindings.
 */
export interface SiteDefinition {
	id: string;
	displayName: string;
	/** `scheme://host[:port]` — single origin in v0; multi-origin is v1. */
	origin: string;
	/** Keyed by page name. */
	pages: Record<string, PageDef>;
}
