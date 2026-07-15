// TYPE-SYSTEM SPIKE (ticket #5) — THROWAWAY. Type-tests for the `03` DSL HELPERS: the `resource`
// overloads (TypeBox vs the raw-JSON escape hatch) + `key` typing, `defineInterface` and the
// `ctx.jsonLd` Interface/Resource discriminant, the `asset.<kind>` value helpers, and the `presence`
// rate guard. Declared surface only (never runs). Mirrors docs/plan/03-framework-dsl.md
// § Acceptance criteria. Delete or absorb when #10 lands.

import Type from "typebox";
import { expectTypeOf, test } from "vitest";
import { asset, defineInterface, presence, resource } from "./spike-dsl";
import type { Asset, ExtractContext, JsonSchema, Resource } from "@sitely/contracts";

declare const ctx: ExtractContext;
declare const url: string;

test("resource's raw-JSON-Schema overload erases the item type to `unknown`", () => {
	// A non-TypeBox schema at the JsonSchema boundary loses field-level typing: `T = unknown`.
	const raw = resource("x", { type: "object" } as JsonSchema);
	expectTypeOf(raw).toEqualTypeOf<Resource<"x", unknown>>();
});

test("resource's `key` is constrained to `keyof Static<schema>`", () => {
	// `id` is a key of `{ id: number }` — compiles.
	resource("s", Type.Object({ id: Type.Number() }), { key: "id" });
	// @ts-expect-error — `key` must be `keyof Static<S>`; "nope" is not a valid key.
	resource("s", Type.Object({ id: Type.Number() }), { key: "nope" });
});

test("defineInterface + ctx.jsonLd(iface) returns the schema's `Static<>` type", () => {
	const iface = defineInterface("Article", Type.Object({ headline: Type.String() }));
	expectTypeOf(ctx.jsonLd(iface)).toEqualTypeOf<{ headline: string }[]>();
});

test('ctx.jsonLd rejects a Resource — it lacks the `kind: "interface"` discriminant', () => {
	const someResource = resource("s", Type.Object({ id: Type.Number() }), { key: "id" });
	// @ts-expect-error — a Resource is structurally name+schema but carries no `kind: "interface"`.
	ctx.jsonLd(someResource);
});

test("asset value helpers carry the literal media kind", () => {
	expectTypeOf(asset.image(url)).toEqualTypeOf<Asset<"image">>();
	expectTypeOf(asset.video(url, { format: "hls" })).toEqualTypeOf<Asset<"video">>();
});

test("presence guards its rate to a number literal in [0,1]", () => {
	const schema = Type.Object({ headline: Type.String() });
	// In range — compiles, and `presence` returns the schema unchanged.
	expectTypeOf(presence(schema, 0.5)).toEqualTypeOf<typeof schema>();
	// @ts-expect-error — 1.5 is out of [0,1]; the rate must be a number literal in range.
	presence(schema, 1.5);
	// @ts-expect-error — a negative rate is out of [0,1].
	presence(schema, -0.25);
});
