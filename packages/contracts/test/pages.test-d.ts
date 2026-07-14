import { test } from "vitest";
import type { PageDef, URLCodec } from "../src/index";

// Proves the PageDef discriminated union's load-bearing `prepare?: never` guard: an interaction hook
// is legal ONLY on the `render: "dynamic"` arm. The static arm declares `prepare?: never`, so a stray
// `prepare` survives neither an explicit `render: "static"` NOR — the half mere absence would miss —
// an OMITTED `render`, where `prepare` (a known key of the dynamic arm) escapes excess-property
// checking and only `prepare?: never` rejects it. (Spec: 00 · Acceptance criteria — "Declaring
// `prepare` on a `render: "static"` or render-omitted page → compile error".)

declare const path: URLCodec;

test("`prepare` is legal on a dynamic page, and a static page may omit it", () => {
	// (a) render: "dynamic" WITH prepare — compiles.
	const dynamicWithPrepare: PageDef = {
		render: "dynamic",
		path,
		validate: () => true,
		prepare: async () => {},
		extract: {},
		fixtures: [],
	};

	// (d) render omitted (the static default) WITHOUT prepare — compiles.
	const staticNoPrepare: PageDef = {
		path,
		validate: () => true,
		extract: {},
		fixtures: [],
	};

	// The `: PageDef` annotations above ARE the positive assertions — an ill-typed literal would not
	// compile. `void` consumes the bindings (noUnusedLocals) without comparing a control-flow-narrowed
	// single arm to the whole union, which never holds.
	void dynamicWithPrepare;
	void staticNoPrepare;
});

test("`prepare` is rejected on the static arm — explicit and render-omitted", () => {
	// (b) render: "static" WITH prepare — the static arm types `prepare` as `never`.
	// @ts-expect-error — `prepare` is not assignable to `never` on the static arm.
	const staticWithPrepare: PageDef = {
		render: "static",
		path,
		validate: () => true,
		prepare: async () => {},
		extract: {},
		fixtures: [],
	};

	// (c) render OMITTED WITH prepare — the case mere absence would miss. `prepare` is a known key of
	// the dynamic arm, so it clears excess-property checking; only `prepare?: never` rejects it.
	// @ts-expect-error — render-omitted literal defaults to the static arm, whose `prepare` is `never`.
	const renderOmittedWithPrepare: PageDef = {
		path,
		validate: () => true,
		prepare: async () => {},
		extract: {},
		fixtures: [],
	};

	void staticWithPrepare;
	void renderOmittedWithPrepare;
});
