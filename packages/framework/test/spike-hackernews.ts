// TYPE-SYSTEM SPIKE (ticket #5) — THROWAWAY. A realistic Hacker News definition authored against the
// spike DSL, the real `urlCodec`, and real `typebox@1.2.8` schemas — the concrete test case that
// exercises the whole inference chain end to end. Field bodies are illustrative (the spike proves
// TYPES, never runs). Delete or absorb when #10 lands.

import Type from "typebox";
import { urlCodec } from "@sitely/url-codec";
import { defineSite, page, resource } from "./spike-dsl";

// A nested TypeBox schema — flat scalars, an optional string, an array, and a deep optional object
// (an array of objects) — to exercise `FieldFns<Static<schema>>` on real nesting.
const Story = resource(
	"story",
	Type.Object({
		id: Type.Number(),
		title: Type.String(),
		url: Type.Optional(Type.String()),
		score: Type.Number(),
		by: Type.String(),
		descendants: Type.Number(),
		kids: Type.Array(Type.Number()),
		poll: Type.Optional(
			Type.Object({
				options: Type.Array(Type.Object({ text: Type.String(), score: Type.Number() })),
			}),
		),
	}),
	{ key: "id" },
);

const Comment = resource(
	"comment",
	Type.Object({
		id: Type.Number(),
		by: Type.String(),
		text: Type.String(),
		parent: Type.Number(),
		kids: Type.Array(Type.Number()),
	}),
	{ key: "id" },
);

// The item page: `/item?id=:id` → params `{ id: string }`, threaded into `validate` and every binding.
const itemPage = page({
	path: urlCodec("/item?id=:id"),
	validate: (ctx) => ctx.params.id.length > 0,
	extract: (p) => ({
		// `one` — a single Story; field functions typed against `Static<Story schema>` (incl. the
		// optional `url`, the `kids` array, and the deep optional `poll` object).
		story: p.one(Story, (ctx) => ({
			id: () => Number(ctx.params.id),
			title: () => ctx.$("title")?.text() ?? "",
			url: () => ctx.$("a.titlelink")?.attr("href") ?? undefined,
			score: () => Number(ctx.$("#score_" + ctx.params.id)?.text() ?? "0"),
			by: () => ctx.$(".hnuser")?.text() ?? "",
			descendants: () => Number(ctx.$(".subline")?.text() ?? "0"),
			kids: () => ctx.$$(".comment").map((el) => Number(el.attr("data-id") ?? "0")),
			poll: () => undefined,
		})),
		// `many` — a Comment per node; the extract returns an ARRAY of field-function maps.
		comments: p.many(Comment, (ctx) =>
			ctx.$$(".comtr").map((el) => ({
				id: () => Number(el.attr("id") ?? "0"),
				by: () => el.$(".hnuser")?.text() ?? "",
				text: () => el.$(".commtext")?.text() ?? "",
				parent: () => Number(ctx.params.id),
				kids: () => [],
			})),
		),
	}),
	fixtures: [{ params: { id: "8863" } }, { params: { id: "1" }, errorCase: "removed" }],
});

export const hackerNews = defineSite({
	id: "hackernews",
	displayName: "Hacker News",
	origin: "https://news.ycombinator.com",
	pages: { item: itemPage },
});
