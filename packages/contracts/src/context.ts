import type { PageElement } from "./read-surface";
import type { Interface } from "./schema";

/**
 * What `validate`/`extract` see — the driver's synchronous read surface plus request metadata. The
 * runtime builds it (`makeContext`, 02) from a materialized `PageDriver` + params; async work
 * (`launch → prepare → materialize`) has already happened, so everything here is sync. The runtime
 * memoises `jsonLd` and the canonical computation internally, keyed by referential equality — there
 * is no public `lazy`. (Spec: 00 · ExtractContext.)
 */
export interface ExtractContext<TParams extends Record<string, string> = Record<string, string>> {
	/** First matching element in the document, or `null` (delegates to the driver). */
	$(selector: string): PageElement | null;
	/** All matching elements in the document. */
	$$(selector: string): PageElement[];
	/** RAW: normalized JSON-LD entities in document order, optionally filtered by exact `@type`. */
	jsonLd(type?: string): Record<string, unknown>[];
	/** PARSED: entities matching `iface.name` that VALIDATE against `iface.schema`; others dropped. */
	jsonLd<T>(iface: Interface<string, T>): T[];
	params: TParams;
	url: string;
	status: number;
	headers: Record<string, string>;
	/** Href of the first `<link rel="canonical">`, verbatim; `null` if absent. */
	canonical: string | null;
}
