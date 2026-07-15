// TYPE-SYSTEM SPIKE (ticket #5) — THROWAWAY. Proves `Page<E>` ERASURE and the `prepare?: never` guard
// through the spike DSL, against the LOCKED `@sitely/contracts`. Convention mirrors spike-probe
// (vitest `expectTypeOf` + `// @ts-expect-error`). Delete/fold when #10 lands.
//
// SPIKE FINDINGS asserted below:
//  1. Erasure needs NO variance cast. `03` (§ lines ~136-140) predicts a `strictFunctionTypes` cast at
//     the erase point; it is MOOT under the locked contracts. `Binding.extract` (contracts/resources.ts)
//     takes the DEFAULT `ExtractContext` — never `ExtractContext<TParams>` — so a page's `TParams` never
//     enters the `Binding`/`Page<E>` type. A specific `Page<E>` is thus plainly assignable to the default
//     `Page`, and `defineSite({ pages: { p: pg } })` compiles with no cast (verified with tsc 6.0.3).
//  2. The `prepare` guard fires, but the error ANCHORS ON THE `page({` CALL LINE (a whole-argument TS2345
//     union mismatch), NOT on the `prepare` property. For a render-OMITTED page TS elaborates about the
//     missing `render` (best-match picks the dynamic arm) — so the `@ts-expect-error` sits on the call
//     line, and the omitted-case message concerns `render`, not `prepare`.

import Type from "typebox";
import { expectTypeOf, test } from "vitest";
import { urlCodec } from "@sitely/url-codec";
import { defineSite, page, resource, type Page } from "./spike-dsl";
import type { SiteDefinition } from "@sitely/contracts";

const R = resource("r", Type.Object({ n: Type.Number(), s: Type.String() }));

test("Page<E> with typed params erases into a plain SiteDefinition — no variance cast", () => {
	// `pg` carries specific params (`{ id: string }`) and a concrete `E` (`{ story: Binding<"r", …> }`).
	const pg = page({
		path: urlCodec("/x?id=:id"),
		validate: (ctx) => ctx.params.id.length > 0,
		extract: (p) => ({
			story: p.one(R, (ctx) => ({ n: () => Number(ctx.params.id), s: () => "x" })),
		}),
		fixtures: [{ params: { id: "1" } }],
	});

	// THE FINDING, asserted directly: the specific `Page<E>` is assignable to the default `Page`. Because
	// the locked `Binding.extract` uses the DEFAULT `ExtractContext`, no contravariant param blocks this —
	// no cast is required (contrast `03` §, which predicts one).
	expectTypeOf(pg).toMatchTypeOf<Page>();

	// …so `pg` flows straight through `defineSite`'s `pages: Record<string, Page>`, erasing `E` down to the
	// runtime `SiteDefinition` (had a cast been needed, this call would not compile).
	const site = defineSite({
		id: "s",
		displayName: "S",
		origin: "https://example.com",
		pages: { p: pg },
	});
	expectTypeOf(site).toEqualTypeOf<SiteDefinition>();
});

test('prepare on a render:"static" page is a compile error (static arm sets prepare?: never)', () => {
	// @ts-expect-error — static arm's `prepare?: never` rejects a function (TS2345 anchors on this call line, not the prepare property).
	page({
		render: "static",
		path: urlCodec("/x?id=:id"),
		validate: () => true,
		prepare: async () => {},
		extract: (p) => ({ story: p.one(R, () => ({ n: () => 1, s: () => "x" })) }),
		fixtures: [{ params: { id: "1" } }],
	});
});

test("prepare on a render-omitted page is a compile error (defaults to the static arm)", () => {
	// @ts-expect-error — no `render` ⇒ static default (`prepare?: never`); matches neither arm (TS2345 on this call line).
	page({
		path: urlCodec("/x?id=:id"),
		validate: () => true,
		prepare: async () => {},
		extract: (p) => ({ story: p.one(R, () => ({ n: () => 1, s: () => "x" })) }),
		fixtures: [{ params: { id: "1" } }],
	});
});

test('prepare on a render:"dynamic" page compiles (the dynamic arm allows prepare)', () => {
	page({
		render: "dynamic",
		path: urlCodec("/x?id=:id"),
		validate: () => true,
		prepare: async () => {},
		extract: (p) => ({ story: p.one(R, () => ({ n: () => 1, s: () => "x" })) }),
		fixtures: [{ params: { id: "1" } }],
	});
});
