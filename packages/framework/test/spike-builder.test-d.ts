// SPIKE #5 builder-capture probe (throwaway) — the fan-out over the builder-inference points the
// tightness probe (spike-probe.test-d.ts) doesn't cover: (1) `page()` captures its extract map `E`
// SPECIFICALLY via the `const` type parameter (not widened to the `Record<string, Binding>` default),
// surfaced through `Page<E>`; (2) `FieldFns<Static<schema>>` descends into a NESTED object schema;
// (3) a `p.many` extract must return an ARRAY of field maps; (4) a `p.one` extract must return a
// SINGLE field map. Compile-time only — the spike proves TYPES, never runs. Delete/fold when #10 lands.

import Type, { type Static } from "typebox";
import { expectTypeOf, test } from "vitest";
import { urlCodec } from "@sitely/url-codec";
import type { Binding } from "@sitely/contracts";
import { page, resource, type Page } from "./spike-dsl";

// Two flat resources for the capture + cardinality tests; `Static<>` gives each item type.
const storySchema = Type.Object({ id: Type.Number(), title: Type.String() });
const commentSchema = Type.Object({ id: Type.Number(), text: Type.String() });
type StoryT = Static<typeof storySchema>;
type CommentT = Static<typeof commentSchema>;

const Story = resource("story", storySchema, { key: "id" });
const Comment = resource("comment", commentSchema, { key: "id" });

// A resource with a DEEP nested object (an array of objects) to exercise FieldFns nesting.
const pollSchema = Type.Object({
	id: Type.Number(),
	poll: Type.Object({
		options: Type.Array(Type.Object({ text: Type.String(), score: Type.Number() })),
	}),
});
const PollStory = resource("story", pollSchema);

// The shape `page()` must capture into `E` — specific binding names, item types, AND cardinalities.
type ItemBindings = {
	story: Binding<"story", StoryT, "one">;
	comments: Binding<"comment", CommentT, "many">;
};

test("`page()` captures `E` specifically via the const type parameter (Page<E> is not widened)", () => {
	const pg = page({
		path: urlCodec("/item?id=:id"),
		validate: () => true,
		extract: (p) => ({
			story: p.one(Story, () => ({ id: () => 1, title: () => "" })),
			comments: p.many(Comment, () => [{ id: () => 1, text: () => "" }]),
		}),
		fixtures: [{ params: { id: "1" } }],
	});
	// Passes ONLY if `E` kept both keys with their exact names, item types, and cardinalities: a
	// widening to the `Record<string, Binding>` default is NOT assignable to `Page<ItemBindings>`
	// (its `Binding` has `name: string`, not the literal `"story"`/`"comment"`), so this would fail.
	expectTypeOf(pg).toMatchTypeOf<Page<ItemBindings>>();
});

test("FieldFns descends into a nested object schema (deep leaf types are enforced)", () => {
	page({
		path: urlCodec("/item?id=:id"),
		validate: () => true,
		extract: (p) => ({
			// The correct nested shape compiles — proves FieldFns reaches `poll.options[].{text,score}`.
			good: p.one(PollStory, () => ({
				id: () => 1,
				poll: () => ({ options: [{ text: "x", score: 2 }] }),
			})),
			bad: p.one(PollStory, () => ({
				id: () => 1,
				// @ts-expect-error — nested `poll.options[].score` must be `number`, not `string`.
				poll: () => ({ options: [{ text: "x", score: "nope" }] }),
			})),
		}),
		fixtures: [],
	});
});

test("a `p.many` extract returning a single field map (not an array) is a compile error", () => {
	page({
		path: urlCodec("/item?id=:id"),
		validate: () => true,
		extract: (p) => ({
			// @ts-expect-error — `many` extract must return `FieldFns<T>[]`, not one `FieldFns<T>`.
			comments: p.many(Comment, () => ({ id: () => 1, text: () => "" })),
		}),
		fixtures: [],
	});
});

test("a `p.one` extract returning an array (not a single field map) is a compile error", () => {
	page({
		path: urlCodec("/item?id=:id"),
		validate: () => true,
		extract: (p) => ({
			// @ts-expect-error — `one` extract must return a single `FieldFns<T>`, not `FieldFns<T>[]`.
			story: p.one(Story, () => [{ id: () => 1, title: () => "" }]),
		}),
		fixtures: [],
	});
});
