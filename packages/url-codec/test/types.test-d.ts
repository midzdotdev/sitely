import { expectTypeOf, test } from "vitest";
import { urlCodec } from "../src/index";
import type { URLCodec } from "../src/index";

// Validates the ExtractParams inference crux against the spec's type-level criteria.

test("infers required and optional params from path + query", () => {
	expectTypeOf(urlCodec("/item?id=:id")).toEqualTypeOf<URLCodec<{ id: string }>>();

	expectTypeOf(urlCodec("/r/:sub/:slug?")).toEqualTypeOf<
		URLCodec<{ sub: string; slug?: string }>
	>();

	// Deeper path, trailing optional (spec example).
	expectTypeOf(urlCodec("/r/:sub/comments/:id/:slug?")).toEqualTypeOf<
		URLCodec<{ sub: string; id: string; slug?: string }>
	>();

	// Optional query param alongside a required one.
	expectTypeOf(urlCodec("/search?type=job&q=:q&sort=:sort?")).toEqualTypeOf<
		URLCodec<{ q: string; sort?: string }>
	>();

	// A required path param immediately before the query separator stays REQUIRED
	// (the `?` after `:id` is the separator, not an optional marker).
	expectTypeOf(urlCodec("/item/:id?ref=:ref")).toEqualTypeOf<
		URLCodec<{ id: string; ref: string }>
	>();
});

test("toUrl requires every required param at compile time", () => {
	const codec = urlCodec("/item/:id");
	// @ts-expect-error — `id` is required and missing.
	codec.toUrl({});
	codec.toUrl({ id: "1" });
});

test("optional params may be omitted from toUrl", () => {
	const codec = urlCodec("/r/:sub/:slug?");
	codec.toUrl({ sub: "webdev" });
	codec.toUrl({ sub: "webdev", slug: "a-post" });
});
