import { describe, expect, it } from "vitest";
import { urlCodec, URLCodecError } from "../src/index";

/**
 * Spec 05 · "Encoding table" acceptance criteria — %2F, unicode, empty values,
 * duplicate keys, a literal `+`, and ignored noise — exercised on both `toUrl`
 * and `fromUrl`. Param values are decoded strings on both sides; the wire form
 * is generic percent-encoding (`encodeURIComponent` semantics), so a space is
 * `%20` and `+` is a literal plus — never form-encoding.
 */

/** Run `fn` and return whatever it throws; fail the test if it returns normally. */
function captureThrow(fn: () => unknown): unknown {
	try {
		fn();
	} catch (err) {
		return err;
	}
	throw new Error("expected the call to throw, but it returned normally");
}

describe("encoding table", () => {
	describe("%2F stays within one segment", () => {
		const codec = urlCodec("/item/:id");

		it("fromUrl decodes %2F to a literal slash inside a single segment", () => {
			expect(codec.fromUrl("/item/a%2Fb")).toEqual({ id: "a/b" });
		});

		it("toUrl re-encodes a slash in the value as %2F", () => {
			expect(codec.toUrl({ id: "a/b" })).toBe("/item/a%2Fb");
		});
	});

	describe("unicode round-trips as UTF-8 percent-encoding", () => {
		it("re-encodes a non-ASCII path value and decodes it back", () => {
			const codec = urlCodec("/item/:id");
			expect(codec.toUrl({ id: "café" })).toBe("/item/caf%C3%A9");
			expect(codec.fromUrl("/item/caf%C3%A9")).toEqual({ id: "café" });
			expect(codec.fromUrl(codec.toUrl({ id: "café" }))).toEqual({ id: "café" });
		});

		it("handles an astral-plane (4-byte) query value", () => {
			const codec = urlCodec("/s?q=:q");
			expect(codec.toUrl({ q: "😀" })).toBe("/s?q=%F0%9F%98%80");
			expect(codec.fromUrl("/s?q=%F0%9F%98%80")).toEqual({ q: "😀" });
		});
	});

	describe("toUrl rejects absent or empty required params", () => {
		const codec = urlCodec("/item/:id");

		it("throws empty-param for an empty-string value", () => {
			const err = captureThrow(() => codec.toUrl({ id: "" }));
			expect(err).toBeInstanceOf(URLCodecError);
			expect((err as URLCodecError).kind).toBe("empty-param");
		});

		it("throws missing-param when a required param is absent", () => {
			// Cast past the compile-time guard to exercise the runtime check.
			const err = captureThrow(() => codec.toUrl({} as { id: string }));
			expect(err).toBeInstanceOf(URLCodecError);
			expect((err as URLCodecError).kind).toBe("missing-param");
		});
	});

	describe("query decoding", () => {
		it("keeps the first occurrence of a duplicated query key", () => {
			const codec = urlCodec("/item?id=:id");
			expect(codec.fromUrl("/item?id=1&id=2")).toEqual({ id: "1" });
		});

		it("treats `+` as a literal plus, not a space", () => {
			const codec = urlCodec("/s?q=:q");
			expect(codec.fromUrl("/s?q=a+b")).toEqual({ q: "a+b" });
			// toUrl emits the plus percent-encoded, and the round-trip recovers it.
			expect(codec.toUrl({ q: "a+b" })).toBe("/s?q=a%2Bb");
			expect(codec.fromUrl(codec.toUrl({ q: "a+b" }))).toEqual({ q: "a+b" });
		});

		it("encodes a space as %20 and decodes it back", () => {
			const codec = urlCodec("/s?q=:q");
			expect(codec.toUrl({ q: "a b" })).toBe("/s?q=a%20b");
			expect(codec.fromUrl("/s?q=a%20b")).toEqual({ q: "a b" });
		});

		it("ignores an extraneous query param and a #fragment", () => {
			const codec = urlCodec("/item?id=:id");
			expect(codec.fromUrl("/item?id=1&utm_source=x")).toEqual({ id: "1" });
			expect(codec.fromUrl("/item?id=1#comments")).toEqual({ id: "1" });
			expect(codec.fromUrl("/item?id=1&utm_source=x#comments")).toEqual({ id: "1" });
		});
	});
});
