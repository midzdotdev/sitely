import { describe, expect, it } from "vitest";
import { urlCodec, URLCodecError } from "../src/index";

/**
 * Spec 05 · "Construction rejections" acceptance criteria — a wildcard, a regex
 * group, and a duplicate param name are `invalid-pattern`; an alias exposing a
 * different param set is `alias-params-mismatch`. Each throws at `urlCodec(...)`
 * construction time. Ambiguity detection is out of scope for v0 and not tested.
 */

/** Run `fn` and return whatever it throws; fail the test if it returns normally. */
function captureThrow(fn: () => unknown): unknown {
	try {
		fn();
	} catch (err) {
		return err;
	}
	throw new Error("expected urlCodec() to throw, but it returned a codec");
}

describe("construction rejections", () => {
	it("rejects a wildcard `*` as invalid-pattern", () => {
		const err = captureThrow(() => urlCodec("/files/*"));
		expect(err).toBeInstanceOf(URLCodecError);
		expect((err as URLCodecError).kind).toBe("invalid-pattern");
	});

	it("rejects a `(regex)` group as invalid-pattern", () => {
		const err = captureThrow(() => urlCodec("/item/(\\d+)"));
		expect(err).toBeInstanceOf(URLCodecError);
		expect((err as URLCodecError).kind).toBe("invalid-pattern");
	});

	it("rejects a duplicate param name as invalid-pattern", () => {
		const err = captureThrow(() => urlCodec("/item/:id/:id"));
		expect(err).toBeInstanceOf(URLCodecError);
		expect((err as URLCodecError).kind).toBe("invalid-pattern");
	});

	it("rejects a mid-segment path param like `/@:user` as invalid-pattern", () => {
		const err = captureThrow(() => urlCodec("/@:user"));
		expect(err).toBeInstanceOf(URLCodecError);
		expect((err as URLCodecError).kind).toBe("invalid-pattern");
	});

	it("rejects a mid-value query param like `/x?ref=a:b` as invalid-pattern", () => {
		const err = captureThrow(() => urlCodec("/x?ref=a:b"));
		expect(err).toBeInstanceOf(URLCodecError);
		expect((err as URLCodecError).kind).toBe("invalid-pattern");
	});

	it("rejects an alias exposing different params as alias-params-mismatch", () => {
		const err = captureThrow(() => urlCodec("/item/:id", { aliases: ["/thing/:slug"] }));
		expect(err).toBeInstanceOf(URLCodecError);
		expect((err as URLCodecError).kind).toBe("alias-params-mismatch");
	});
});
