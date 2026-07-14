import { expect, test } from "vitest";
import { urlCodec } from "../src/index";

/*
 * `base` semantics (05-url-codec.md § base, § Acceptance criteria). A codec carries no origin;
 * `base` contributes ORIGIN ONLY. Absolute-input matches are decided by WHATWG `URL.origin`
 * equality (default ports normalised); relative input matches regardless of `base`.
 */

test("toUrl with base yields an absolute URL whose path+query equal the baseless result", () => {
	const codec = urlCodec("/item/:id?ref=:ref");
	const params = { id: "42", ref: "a b" }; // the space exercises encoding under a base

	const baseless = codec.toUrl(params);
	expect(baseless.startsWith("/")).toBe(true); // baseless output is root-relative

	const abs = codec.toUrl(params, { base: "https://ex.com" });
	const u = new URL(abs);
	expect(u.origin).toBe("https://ex.com");
	expect(u.pathname + u.search).toBe(baseless); // path + query equal the baseless result
	expect(abs).toBe(`https://ex.com${baseless}`);

	// `base` as a URL instance, and any PATH in the base is ignored (origin only).
	expect(codec.toUrl(params, { base: new URL("https://ex.com/ignored/path?x=1") })).toBe(
		`https://ex.com${baseless}`,
	);

	// A non-default port is preserved verbatim.
	const pathOnly = urlCodec("/item/:id");
	const p2 = { id: "9" };
	expect(pathOnly.toUrl(p2, { base: "http://h:8080" })).toBe(`http://h:8080${pathOnly.toUrl(p2)}`);
});

test("absolute-input matches are decided by origin equality, with default-port normalisation", () => {
	const codec = urlCodec("/item/:id");

	// Exact origin.
	expect(codec.fromUrl("https://ex.com/item/5", { base: "https://ex.com" })).toEqual({ id: "5" });

	// Default-port normalisation: :80 == http default, :443 == https default (either side).
	expect(codec.fromUrl("http://h:80/item/5", { base: "http://h" })).toEqual({ id: "5" });
	expect(codec.fromUrl("http://h/item/5", { base: "http://h:80" })).toEqual({ id: "5" });
	expect(codec.fromUrl("https://h:443/item/5", { base: "https://h" })).toEqual({ id: "5" });

	// `base` as a URL instance whose path is irrelevant to the origin check.
	expect(
		codec.fromUrl("https://ex.com/item/5", { base: new URL("https://ex.com/elsewhere") }),
	).toEqual({ id: "5" });
});

test("an absolute input whose origin differs from base does not match (null, not an error)", () => {
	const codec = urlCodec("/item/:id");

	expect(codec.fromUrl("https://other.com/item/5", { base: "https://ex.com" })).toBeNull(); // host
	expect(codec.fromUrl("https://sub.ex.com/item/5", { base: "https://ex.com" })).toBeNull(); // subdomain
	expect(codec.fromUrl("http://ex.com/item/5", { base: "https://ex.com" })).toBeNull(); // scheme
	expect(codec.fromUrl("http://h:81/item/5", { base: "http://h" })).toBeNull(); // non-default port
});

test("a relative input matches without a base, and a base never gates relative input", () => {
	const codec = urlCodec("/p/:id?tab=:tab");

	// Relative input matches directly.
	expect(codec.fromUrl("/p/7?tab=info")).toEqual({ id: "7", tab: "info" });

	// `base` is only an origin gate for ABSOLUTE inputs; a relative input still matches.
	expect(codec.fromUrl("/p/7?tab=info", { base: "https://ex.com" })).toEqual({
		id: "7",
		tab: "info",
	});

	// Without a base, an absolute input matches on path + query with the origin unchecked.
	expect(codec.fromUrl("https://anything.example/p/7?tab=info")).toEqual({ id: "7", tab: "info" });

	// Noise and a fragment are ignored even when matching under a base.
	expect(
		codec.fromUrl("https://ex.com/p/7?tab=info&utm_source=x#frag", { base: "https://ex.com" }),
	).toEqual({ id: "7", tab: "info" });
});
