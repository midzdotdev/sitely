// SPIKE #5 tightness probe (throwaway) — confirms the inference is SHARP, not merely compiling: a
// clean happy-path compile could hide `TParams` degrading to the `Record<string, string>` default or
// `E` widening. Deleted/folded once the fan-out suite lands.
import Type from "typebox";
import { expectTypeOf, test } from "vitest";
import type { FixtureSpec } from "@sitely/contracts";
import { urlCodec } from "@sitely/url-codec";
import { page, resource } from "./spike-dsl";

const R = resource("r", Type.Object({ n: Type.Number(), s: Type.String() }));

test("TParams is inferred SHARPLY from the path codec (not the default)", () => {
	page({
		path: urlCodec("/x?id=:id"),
		validate: (ctx) => {
			// The exact-type equality is itself the sharpness proof — it fails if params widened to
			// the `Record<string, string>` default (which is not equal to `{ id: string }`).
			expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
			return true;
		},
		extract: (p) => ({
			item: p.one(R, (ctx) => {
				expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
				return { n: () => 1, s: () => "x" };
			}),
		}),
		fixtures: [{ params: { id: "1" } }],
	});
});

test("a field function whose return type mismatches the schema is a compile error", () => {
	page({
		path: urlCodec("/x?id=:id"),
		validate: () => true,
		extract: (p) => ({
			item: p.one(R, () => ({
				// @ts-expect-error — `n` must be `() => number`, not `() => string`.
				n: () => "nope",
				s: () => "x",
			})),
		}),
		fixtures: [],
	});
});

test("fixtures[i].params is typed to the page's params (a wrong key is a compile error)", () => {
	// Asserted directly on FixtureSpec<TParams> — robust placement, since a bad `fixtures` inside
	// page({...}) anchors the error on the whole-argument union, not the property line.
	const ok: FixtureSpec<{ id: string }> = { params: { id: "1" } };
	void ok;
	// @ts-expect-error — `wrong` is not a param of `{ id: string }`; FixtureSpec<TParams> pins the params.
	const bad: FixtureSpec<{ id: string }> = { params: { wrong: "x" } };
	void bad;
});
