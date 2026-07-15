import { expectTypeOf, test } from "vitest";
import type { ExtractContext, Interface, Resource } from "../src/index";

// Proves the two `jsonLd` overloads on ExtractContext and the Interface-vs-Resource discriminant
// that keeps a Resource out of the parsed overload. (Spec: 00 · ExtractContext / Acceptance criteria.)

declare const ctx: ExtractContext;
declare const iface: Interface<"Article", { headline: string }>;
declare const resource: Resource<"post", { id: string }>;

test("jsonLd RAW overload returns untyped entities, with or without a type filter", () => {
	expectTypeOf(ctx.jsonLd()).toEqualTypeOf<Record<string, unknown>[]>();
	expectTypeOf(ctx.jsonLd("Article")).toEqualTypeOf<Record<string, unknown>[]>();
});

test("jsonLd PARSED overload returns the Interface's static type as an array", () => {
	expectTypeOf(ctx.jsonLd(iface)).toEqualTypeOf<{ headline: string }[]>();
});

test("a Resource is not an Interface — no jsonLd overload matches", () => {
	// @ts-expect-error — a Resource lacks `kind: "interface"`, so neither overload accepts it.
	ctx.jsonLd(resource);
});
