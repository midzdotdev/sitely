import fc from "fast-check";
import { expect, test } from "vitest";
import { urlCodec } from "../src/index";

/*
 * Property-based acceptance criteria for the URL codec (05-url-codec.md § Acceptance criteria):
 * round-trip, alias collapse, and noise-immunity, with optional params exercised both present
 * and absent. Every property runs fast-check with a FIXED seed so any failure is reproducible.
 *
 * DEFERRED v0 DECISION: ambiguity detection is out of scope for v0 (05-url-codec.md
 * "Open questions"). This generator therefore emits ONLY unambiguous patterns — literal
 * segments plus required params, with AT MOST ONE optional, placed either as the final path
 * segment or as a single trailing optional query pair. No adjacent optionals.
 */

const SEED = 42;
const NUM_RUNS = 300;

/* -------------------------------------------------------------------------- */
/* Param-value arbitrary                                                      */
/* -------------------------------------------------------------------------- */

const ALNUM: string[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

// Encoding stressors: structural characters (which MUST survive as data, not structure),
// path-traversal fragments, unicode (incl. surrogate pairs), and percent-literals.
const STRESS: string[] = [
	"/",
	" ",
	"%",
	"&",
	"=",
	"?",
	"#",
	"+",
	".",
	"..",
	"%2F",
	"a/b",
	"x y",
	"é",
	"ü",
	"ß",
	"ñ",
	"中",
	"日本語",
	"😀",
	"🌍",
];

const coreToken = fc
	.array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 8 })
	.map((cs) => cs.join(""));

const stressToken = fc
	.array(
		fc.oneof(
			fc.constantFrom(...STRESS),
			fc.string({ unit: "grapheme", minLength: 1, maxLength: 3 }),
		),
		{ minLength: 0, maxLength: 3 },
	)
	.map((cs) => cs.join(""));

// Non-empty, and always carrying an alphanumeric core so a path segment is never a bare
// "." or ".." dot-segment — while still exercising '/', spaces, unicode and percent-literals.
const paramValue = fc.tuple(stressToken, coreToken, stressToken).map(([a, b, c]) => `${a}${b}${c}`);

/* -------------------------------------------------------------------------- */
/* Pattern + params co-generator                                              */
/* -------------------------------------------------------------------------- */

interface Spec {
	readonly canonical: string;
	readonly aliases: string[];
	readonly params: Record<string, string>;
}

// Distinct param names and literal segments; no name collides with the "utm_source" noise key.
const NAME_POOL: string[] = [
	"id",
	"sub",
	"slug",
	"q",
	"sort",
	"page",
	"cat",
	"user",
	"post",
	"tag",
];
const LIT_POOL: string[] = [
	"item",
	"board",
	"comments",
	"hub",
	"list",
	"view",
	"shop",
	"zone",
	"area",
	"sec",
];

const specArb: fc.Arbitrary<Spec> = fc
	.record({
		nPath: fc.integer({ min: 0, max: 2 }),
		nQuery: fc.integer({ min: 0, max: 2 }),
		optKind: fc.constantFrom("none", "path", "query"),
		optPresent: fc.boolean(),
		nAliases: fc.integer({ min: 1, max: 2 }),
		names: fc.shuffledSubarray(NAME_POOL, {
			minLength: NAME_POOL.length,
			maxLength: NAME_POOL.length,
		}),
		lits: fc.shuffledSubarray(LIT_POOL, { minLength: LIT_POOL.length, maxLength: LIT_POOL.length }),
	})
	.chain((s) => {
		// Distinct names carved out by role. `noUncheckedIndexedAccess`: the pools are large
		// enough (10 each) that every index used below is in bounds, so `!` is sound here.
		const pathParams = s.names.slice(0, s.nPath);
		const queryParams = s.names.slice(s.nPath, s.nPath + s.nQuery);
		const optName = s.optKind === "none" ? "" : s.names[s.nPath + s.nQuery]!;

		// Each pattern (canonical + each alias) gets a DISJOINT slice of literals, so an alias
		// path never accidentally matches the canonical — the aliases are genuinely exercised.
		const litsPerPattern = Math.max(s.nPath, 1);
		const litsFor = (k: number): string[] =>
			s.lits.slice(litsPerPattern * k, litsPerPattern * (k + 1));

		const build = (lits: string[]): string => {
			let path =
				pathParams.length > 0
					? pathParams.map((p, i) => `/${lits[i]!}/:${p}`).join("")
					: `/${lits[0]!}`;
			if (s.optKind === "path") path += `/:${optName}?`;

			const pairs = queryParams.map((q) => `${q}=:${q}`);
			if (s.optKind === "query") pairs.push(`${optName}=:${optName}?`);
			const query = pairs.length > 0 ? `?${pairs.join("&")}` : "";

			return path + query;
		};

		const canonical = build(litsFor(0));
		const aliases: string[] = [];
		for (let k = 1; k <= s.nAliases; k++) aliases.push(build(litsFor(k)));

		// The optional param is included in `p` only when `optPresent` — so the generator
		// exercises optional params BOTH present and absent across runs.
		const present = [
			...pathParams,
			...queryParams,
			...(s.optKind !== "none" && s.optPresent ? [optName] : []),
		];

		const valuesArb: fc.Arbitrary<Record<string, string>> =
			present.length === 0
				? fc.constant<Record<string, string>>({})
				: fc
						.array(paramValue, { minLength: present.length, maxLength: present.length })
						.map((vals) => {
							const out: Record<string, string> = {};
							present.forEach((n, i) => {
								out[n] = vals[i]!;
							});
							return out;
						});

		return valuesArb.map((params): Spec => ({ canonical, aliases, params }));
	});

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

test("round-trip: fromUrl(toUrl(p)) deep-equals p", () => {
	fc.assert(
		fc.property(specArb, ({ canonical, aliases, params }) => {
			const codec = urlCodec(canonical, { aliases });
			expect(codec.fromUrl(codec.toUrl(params))).toEqual(params);
		}),
		{ seed: SEED, numRuns: NUM_RUNS },
	);
});

test("alias collapse: an alias path parses back to p and collapses to the canonical URL", () => {
	fc.assert(
		fc.property(specArb, ({ canonical, aliases, params }) => {
			const codec = urlCodec(canonical, { aliases });
			const canonicalUrl = codec.toUrl(params);
			for (const alias of aliases) {
				// Build the alias-form path via the alias's OWN single-pattern codec.
				const aliasPath = urlCodec(alias).toUrl(params);
				const recovered = codec.fromUrl(aliasPath);
				expect(recovered).toEqual(params);
				// toUrl(fromUrl(aliasPath)) === toUrl(p): one canonical form.
				expect(codec.toUrl(recovered!)).toBe(canonicalUrl);
			}
		}),
		{ seed: SEED, numRuns: NUM_RUNS },
	);
});

test("noise immunity: appended tracking params and a fragment never change the result", () => {
	fc.assert(
		fc.property(specArb, ({ canonical, aliases, params }) => {
			const codec = urlCodec(canonical, { aliases });
			const url = codec.toUrl(params);
			// Join the tracking param correctly whether or not a query already exists.
			const withNoise = url.includes("?") ? `${url}&utm_source=x` : `${url}?utm_source=x`;
			expect(codec.fromUrl(withNoise)).toEqual(params);
			expect(codec.fromUrl(`${url}#frag`)).toEqual(params);
			expect(codec.fromUrl(`${withNoise}#frag`)).toEqual(params);
		}),
		{ seed: SEED, numRuns: NUM_RUNS },
	);
});
