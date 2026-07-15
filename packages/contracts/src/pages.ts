import type { URLCodec } from "@sitely/url-codec";
import type { Binding } from "./resources";
import type { ExtractContext } from "./context";
import type { PageController } from "./read-surface";
import type { RejectionReason } from "./errors";

/**
 * A page: a URL codec plus how to validate, (optionally) interact, and extract. `prepare` exists
 * ONLY on a dynamic page — a discriminated union on `render`, with an explicit `prepare?: never` in
 * the static arm. The `never` is load-bearing: with `render` OMITTED (the static default), a literal
 * carrying `prepare` is still assignable to the static arm under excess-property rules, so only
 * `prepare?: never` turns the omitted-discriminant case into the promised compile error. `extract`
 * maps local output name → `Binding` (authored via a builder, see 03).
 */
export type PageDef =
	| {
			// static (default): fetch, no interaction phase.
			render?: "static";
			path: URLCodec;
			/** `false` ≡ `ResponseRejection("wrong-page")`. */
			validate: (ctx: ExtractContext) => boolean;
			/** Load-bearing: keeps `prepare` a compile error even with `render` omitted. */
			prepare?: never;
			extract: Record<string, Binding>;
			fixtures: FixtureSpec[];
	  }
	| {
			// dynamic: browser render; `prepare` allowed.
			render: "dynamic";
			path: URLCodec;
			validate: (ctx: ExtractContext) => boolean;
			/** Settle interaction-gated content pre-snapshot. A dynamic page needing none just omits it. */
			prepare?: (page: PageController) => Promise<void>;
			extract: Record<string, Binding>;
			fixtures: FixtureSpec[];
	  };

/** A fixture: params to build the URL, and optionally an expected rejection. */
export interface FixtureSpec<TParams extends Record<string, string> = Record<string, string>> {
	params: TParams;
	/** `true` = expect any rejection; a `RejectionReason` = expect that one. */
	errorCase?: boolean | RejectionReason;
}
