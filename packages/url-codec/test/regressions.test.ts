import { expect, test } from "vitest";
import { urlCodec, URLCodecError } from "../src/index";

// Regressions for edge cases surfaced by the adversarial review of ticket #4, plus
// documentation of the deliberate v0 limitations (skipped — un-skip when addressed).

test("with-base toUrl keeps the query byte-identical to the baseless canonical (apostrophe)", () => {
	// encodeURIComponent leaves "'" literal; the with-base form must not re-encode it
	// (routing through new URL().href would), else the canonical / cache key drifts.
	const codec = urlCodec("/s?q=:q");
	expect(codec.toUrl({ q: "a'b" })).toBe("/s?q=a'b");
	expect(codec.toUrl({ q: "a'b" }, { base: "https://ex.com" })).toBe("https://ex.com/s?q=a'b");
});

test("protocol-relative input is guarded by the origin gate", () => {
	const codec = urlCodec("/item/:id");
	// Cross-authority protocol-relative under a base → rejected (authority differs).
	expect(codec.fromUrl("//evil.com/item/5", { base: "https://ex.com" })).toBeNull();
	// Same-authority protocol-relative under a base → matches.
	expect(codec.fromUrl("//ex.com/item/5", { base: "https://ex.com" })).toEqual({ id: "5" });
	// No base → origin unchecked, matches on path + query.
	expect(codec.fromUrl("//anywhere.com/item/5")).toEqual({ id: "5" });
});

/* ---- Known v0 limitations (deliberately unsupported; documented, not fixed) ---------- */

test.skip("LIMITATION: dot-segment values '.'/'..' round-trip — WHATWG URL collapses them", () => {
	// toUrl emits "/a/.." but fromUrl resolves through new URL(), which drops dot-segments.
	// The spec locks toUrl's error surface to missing/empty, so we cannot reject them either.
	const codec = urlCodec("/a/:x");
	expect(codec.fromUrl(codec.toUrl({ x: ".." }))).toEqual({ x: ".." });
});

test("mid-segment / mid-value params are rejected at construction (not silently literal)", () => {
	// Whole-segment (path) / whole-value (query) params only: a ":" that does not occupy
	// the whole segment/value is type-unsound silent data loss — the type-level
	// `ExtractParams` captures the `:name` while the runtime would drop it — so `urlCodec`
	// throws `invalid-pattern` at construction rather than keeping the text as a literal.
	const expectInvalidPattern = (fn: () => unknown): void => {
		let thrown: unknown;
		try {
			fn();
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(URLCodecError);
		expect((thrown as URLCodecError).kind).toBe("invalid-pattern");
	};

	expectInvalidPattern(() => urlCodec("/@:user")); // ":" mid path segment
	expectInvalidPattern(() => urlCodec("/a:b")); // ":" mid path segment
	expectInvalidPattern(() => urlCodec("/x?ref=a:b")); // ":" mid query value
});

test.skip("LIMITATION: a malformed base throws URLCodecError (currently a native TypeError)", () => {
	// A garbage base is a caller programming error; there is no spec error kind for it.
	const codec = urlCodec("/item/:id");
	expect(() => codec.toUrl({ id: "1" }, { base: "not a url" })).toThrow(URLCodecError);
});
