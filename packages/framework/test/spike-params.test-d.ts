// TYPE-SYSTEM SPIKE (ticket #5) — THROWAWAY. Proves the `ExtractParams` half of the inference chain:
// that the codec infers named + optional params over BOTH the path and the query tail, that
// `urlCodec(...)` wires that inference into the `URLCodec` value, that `page(...)` threads the params
// into `ctx.params` (in `validate` and inside a binding's extract), and that the inferred type AGREES
// with `toUrl`'s parameter on optional handling (#5 point 3). Mirrors docs/plan/03-framework-dsl.md
// § Acceptance criteria ("`validate`/`fixtures[i]` `ctx.params` is typed to the page's path AND query
// params"). Types only — nothing runs. Delete or absorb when #10 lands.

import Type from "typebox";
import { expectTypeOf, test } from "vitest";
import { urlCodec } from "@sitely/url-codec";
import { page, resource } from "./spike-dsl";
import type { ExtractParams, URLCodec } from "@sitely/url-codec";
// `ExtractParams` is also re-surfaced from the DSL barrel (00 re-exports it for 03); alias it to prove
// the re-export resolves to the identical type constructor.
import type { ExtractParams as ExtractParamsViaDsl } from "./spike-dsl";

test("ExtractParams reads named + optional params from the path AND the query tail", () => {
	// a required query param → a required string.
	expectTypeOf<ExtractParams<"/item?id=:id">>().toEqualTypeOf<{ id: string }>();
	// a trailing optional PATH segment (`:slug?`) → an optional string.
	expectTypeOf<ExtractParams<"/r/:sub/:slug?">>().toEqualTypeOf<{ sub: string; slug?: string }>();
	// an optional QUERY param — the `?` after `:sort` is the optional marker, not the path/query split.
	expectTypeOf<ExtractParams<"/search?q=:q&sort=:sort?">>().toEqualTypeOf<{
		q: string;
		sort?: string;
	}>();

	// the DSL barrel re-export is the SAME type constructor as the codec's own.
	expectTypeOf<ExtractParamsViaDsl<"/r/:sub/:slug?">>().toEqualTypeOf<
		ExtractParams<"/r/:sub/:slug?">
	>();
});

test("urlCodec(...) carries the inferred params into the URLCodec value", () => {
	// read the params off `toUrl`'s first parameter — the factory returns `URLCodec<ExtractParams<P>>`.
	expectTypeOf(urlCodec("/item?id=:id").toUrl).parameter(0).toEqualTypeOf<{ id: string }>();
	expectTypeOf(urlCodec("/r/:sub/:slug?").toUrl)
		.parameter(0)
		.toEqualTypeOf<{ sub: string; slug?: string }>();
	expectTypeOf(urlCodec("/search?q=:q&sort=:sort?").toUrl)
		.parameter(0)
		.toEqualTypeOf<{ q: string; sort?: string }>();

	// the whole value is `URLCodec<{ sub: string; slug?: string }>` — ties the factory to ExtractParams.
	expectTypeOf(urlCodec("/r/:sub/:slug?")).toEqualTypeOf<
		URLCodec<{ sub: string; slug?: string }>
	>();
});

const Sub = resource("sub", Type.Object({ name: Type.String() }));

test("page(...) threads the codec's params into ctx.params (validate + binding extract)", () => {
	page({
		path: urlCodec("/r/:sub/:slug?"),
		validate: (ctx) => {
			// the OPTIONAL path/query shape survives into `validate`, not the `Record<string, string>` default.
			expectTypeOf(ctx.params).toEqualTypeOf<{ sub: string; slug?: string }>();
			return ctx.params.sub.length > 0;
		},
		extract: (p) => ({
			// the SAME params are visible inside a binding's extract (typed by the page, not the resource).
			item: p.one(Sub, (ctx) => {
				expectTypeOf(ctx.params).toEqualTypeOf<{ sub: string; slug?: string }>();
				return { name: () => ctx.params.sub };
			}),
		}),
		fixtures: [{ params: { sub: "reactjs" } }],
	});
});

test("ExtractParams and toUrl agree on optional handling (#5 point 3)", () => {
	const c = urlCodec("/r/:sub/:slug?");
	// `slug` is omittable — supplying only the required `sub` compiles.
	c.toUrl({ sub: "x" });
	// @ts-expect-error — `sub` is required, so an empty params object is a compile error.
	c.toUrl({});
});
