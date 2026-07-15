import { expectTypeOf, test } from "vitest";
import type { Binding, FieldFns } from "../src/index";

// Type tests for the resource surface (spec: docs/plan/00-contracts.md · src/resources.ts):
// FieldFns wraps every field in a synchronous resolver and strips optionality (`-?`), and a
// Binding's cardinality selects between one FieldFns and an array of them.

test("FieldFns wraps each field in a synchronous resolver", () => {
	expectTypeOf<FieldFns<{ title: string }>>().toEqualTypeOf<{ title: () => string }>();
});

// The `-?` in FieldFns makes every resolver required — even a field that is optional on the source
// item (`score?`) must have a resolver. Proven via assignability so the assertion does not hinge on
// whether the resolver's return widens to `number | undefined`.
declare function acceptPostFields(fns: FieldFns<{ title: string; score?: number }>): void;

test("FieldFns makes a resolver required even for an optional field", () => {
	// @ts-expect-error — `score` resolver is missing; `-?` strips the optional modifier.
	acceptPostFields({ title: () => "post" });

	// Both resolvers present — compiles.
	acceptPostFields({ title: () => "post", score: () => 1 });
});

declare const one: Binding<"post", { id: string }, "one">;
declare const many: Binding<"post", { id: string }, "many">;

test("Binding cardinality drives the extract return shape", () => {
	expectTypeOf(one.extract).returns.toEqualTypeOf<FieldFns<{ id: string }>>();
	expectTypeOf(many.extract).returns.toEqualTypeOf<FieldFns<{ id: string }>[]>();
});
