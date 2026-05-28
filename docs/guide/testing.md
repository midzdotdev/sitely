# The test suite

`sitely test` runs eight checks against your [site package](/overview/glossary#site-package)'s [fixtures](/overview/glossary#fixture) and tells you which ones fail. All eight have to pass before a package version can be marked [verified](/overview/glossary#verified). This page describes what each check does, what a failure looks like, and how to fix it.

## How to run it

```bash
sitely test                              # full suite
sitely test --only fixture-extraction    # one check
sitely test --watch                      # re-run on file change
```

The output is a list of checks, one per line, with pass/fail status and a short reason for any failure:

```
fixture-extraction         ok      12 fixtures
schema-conformance         ok      12 fixtures
determinism                FAIL    fixtures/home: byte-diff at $.publishedAt
schema-emission-roundtrip  ok
locale-matrix              ok      en, fr, de
error-path-coverage        ok      3 error fixtures
manifest-integrity         ok
semver-discipline          ok      no breaking changes
```

Each check prints its **stable name** — the slug on the left, like `fixture-extraction` or `semver-discipline`. Those names don't change between framework versions, so you can match against them in CI scripts and dashboards.

If you want to drill into one failure, re-run with `--only <name>`. To loop on a fix, `--watch` re-runs the suite when files in `fixtures/`, `index.ts`, or `dist/` change.

## The eight checks

### `fixture-extraction`

**What it asserts.** For every fixture, `extract(ctx)` produces output that matches the sibling `<name>.expected.json` after stable serialisation (sorted keys, normalised whitespace, no trailing newline differences).

**Why it exists.** The `.expected.json` file is your package's contract about what its extraction looks like. If running `extract` doesn't reproduce it, the package's output is unstable and downstream consumers can't trust it.

**Failure looks like:**

```
fixture-extraction  FAIL  fixtures/home: extracted output differs from expected at $.author.name
```

**Common reasons:**

- You changed the extractor but forgot to regenerate and commit `<name>.expected.json`.
- The extractor returns object keys in a different order than the expected file. Use `sitely test --update fixtures/home` to overwrite the expected file from the current output, then inspect the diff before committing.
- Whitespace differences sneaking in — leading/trailing spaces in `.text()` calls that you haven't trimmed.

**How to fix.** Run `sitely test --only fixture-extraction --diff fixtures/<name>` to see the structural diff. If the new output is the correct one, run `sitely test --update fixtures/<name>` to refresh the expected file and commit it.

### `schema-conformance`

**What it asserts.** Every extracted output validates against its [resource](/overview/glossary#resource)'s declared [schema](/overview/glossary#schema).

**Why it exists.** The schema is the published contract for consumers. A field that the schema requires but the extractor sometimes omits is a contract break — even if the fixture happens to pass `fixture-extraction`.

**Failure looks like:**

```
schema-conformance  FAIL  fixtures/article: Article.author is required, got undefined
```

**Common reasons:**

- The schema requires a field that some pages on the site genuinely don't have. Mark that field optional in the schema.
- The schema's type is narrower than the data — e.g. `z.string().url()` when the site sometimes emits a path-relative URL.
- The schema expects `Date` but the extractor returns a string. Pick one and stick to it.

**How to fix.** Either loosen the schema (mark optional, widen the type) or fix the extractor to always populate the field. The choice depends on whether the missing data is a fact about the site or a gap in your extractor.

### `determinism`

**What it asserts.** Two consecutive runs of `extract` on the same fixture produce byte-identical output.

**Why it exists.** Caching, signing, and reproducible [manifest](/overview/glossary#manifest) generation all depend on extraction being deterministic. A field that flips between runs poisons the cache and breaks build reproducibility.

**Failure looks like:**

```
determinism  FAIL  fixtures/home: byte-diff at $.fetchedAt across two runs
```

**Common reasons:**

- `Date.now()`, `new Date()` without a fixed input, or anything else that reads the clock.
- `Math.random()`, `crypto.randomUUID()`, or other non-seeded randomness.
- Iterating a `Set` or `Map` and relying on insertion order matching across runs (it does for `Map`, doesn't reliably for `Set` of arbitrary keys).
- Locale-dependent formatting — `toLocaleString()` without an explicit locale.
- Async race conditions: two `Promise.all` calls that resolve in different orders on different runs.

**How to fix.** Replace clock/random calls with pure ones. Sort arrays before returning. Pass explicit locales to formatting functions. If you genuinely need randomness, seed it from a stable input like the URL.

### `schema-emission-roundtrip`

**What it asserts.** The JSON Schema emitted at `dist/schemas/<Name>.json` validates the extraction output. In other words: the JSON Schema the build produces means the same thing as the runtime schema the extractor checked against.

**Why it exists.** Authors write schemas with their preferred validator (Zod, Valibot, ArkType, …) via [Standard Schema](/overview/glossary#standard-schema). The build converts that to [JSON Schema](/overview/glossary#json-schema) so downstream tools — TypeScript codegen, OpenAPI generators, dashboards — can read the package's output shape without depending on your validator choice. If the two disagree, consumers reading the JSON Schema see something different from what your code actually produces.

**Failure looks like:**

```
schema-emission-roundtrip  FAIL  Article: emitted JSON Schema rejects extraction at $.tags[*]
```

**Common reasons:**

- A Zod `.refine(...)` or `.transform(...)` that the JSON Schema conversion can't express. Refinements with arbitrary JavaScript don't have a JSON Schema equivalent.
- A Valibot custom action that doesn't map to a standard JSON Schema keyword.
- Branded types or template literal types that lose information during emission.

**How to fix.** Either replace the unrepresentable construct with one that maps cleanly (e.g. `z.string().regex(...)` instead of `z.string().refine(...)`), or accept that the JSON Schema is a looser version of the runtime schema and document the mismatch in the field's description.

### `locale-matrix`

**What it asserts.** If your site definition declares more than one [locale](/overview/glossary#locale), every [page](/overview/glossary#page) has fixtures for at least two of them.

**What it skips.** A site declaring a single-locale `locales` block (`locales: { values: ["en"], default: "en" }`) gets `locale-matrix` *skipped*, not failed — there's nothing to spread across. If your site genuinely has only one locale, omit the `locales` block entirely.

**Why it exists.** Declaring `locales: { values: ['en', 'fr', 'de'] }` and then only writing English fixtures means you've claimed your package handles three languages without actually testing the locale routing. Real bugs hide in the second locale — URL patterns that assume `en`, validators that match English-only text, extractors that hard-code Latin alphabet assumptions.

**Failure looks like:**

```
locale-matrix  FAIL  page /articles/:slug: declared locales [en, fr, de] but fixtures cover only [en]
```

**Common reasons:**

- You added locales to the site definition but didn't snapshot fixtures for them.
- You snapshot only the default locale because "the others should be the same." They often aren't.

**How to fix.** Run `sitely snapshot <non-default-locale-url>` for at least one URL per page in a second declared locale. Commit the fixture + expected output.

### `error-path-coverage`

**What it asserts.** For every `<name>.error.html` fixture, `validate(ctx)` returns `false`.

**Why it exists.** [validate](/overview/glossary#validate)'s job is to tell real pages apart from captchas, "this content was removed" stubs, login walls, and other not-actually-the-thing HTML the URL pattern happens to match. If your validate accepts an error fixture, the framework would try to extract from it on real traffic and produce garbage.

**Failure looks like:**

```
error-path-coverage  FAIL  fixtures/article.error.html: validate returned true (expected false)
```

**Common reasons:**

- `validate` checks only for the presence of a generic element (a `<header>`, a meta tag) that the error page also has.
- The check is structural ("does an `<article>` tag exist?") and the error stub uses the same shell layout.
- The site reuses its main template for "not found" pages, with only the content swapped.

**How to fix.** Make validate check for something the error page genuinely lacks: a headline element with non-empty text, a specific schema.org tag in JSON-LD, a body element that doesn't contain the site's standard "page not available" string.

### `manifest-integrity`

**What it asserts.** Running `sitely build` from a clean state produces a `dist/manifest.json` byte-identical to the one committed to the repository.

**Why it exists.** The [manifest](/overview/glossary#manifest) is the single declarative description of the package that every downstream tool reads. It needs to be reproducible from source so it can be signed, diffed across versions, and trusted by the server when it loads the package. A manifest that changes from build to build can't carry any of those properties.

**Failure looks like:**

```
manifest-integrity  FAIL  dist/manifest.json differs from rebuild at $.schemas.Article.required[2]
```

**Common reasons:**

- You changed `index.ts` and forgot to rebuild and commit the manifest. Run `sitely build` and `git add dist/manifest.json`.
- A framework upgrade changed how the manifest is emitted. Rebuild against the new framework version and commit.
- Build-environment leakage — for example, a TypeScript version difference producing different inferred schema shapes. Pin the framework version in `package.json` and ensure CI uses the same one.

**How to fix.** Run `sitely build` locally, look at the diff, and commit the regenerated manifest. If the diff doesn't make sense given your changes, treat it as a real bug and investigate before committing.

### `semver-discipline`

**What it asserts.** The freshly-built [manifest](/overview/glossary#manifest) is compared against `dist/baseline-manifest.json` (the previously-published manifest). Breaking changes (resource removed, schema field removed, optional→required, type narrowed, page URL pattern changed) require a major bump in `package.json`. Additive changes (resource added, optional field added, type widened) require at least a minor bump. Cosmetic changes can be any bump.

**Why it exists.** Consumers pin to a [site package](/overview/glossary#site-package) version and send that version on every typed request. A silently-breaking minor release would surface as `409 Site version mismatch` for consumers — frustrating. The check catches the mismatch at publish time, not at consumer-call time.

**Failure looks like:**

```
semver-discipline  FAIL  breaking change detected (resources.article: schema field "author" removed),
                          but package.json shows minor bump 1.4.0 → 1.5.0. Major bump required.
```

**Common reasons:**

- A field was removed from a resource's schema; this is a major bump.
- A URL pattern changed; consumers can't re-derive URLs cleanly — major bump.
- A field changed type in a narrowing direction (`z.string()` → `z.string().email()`); existing data may not match — major bump.
- A new resource was added but the version is still a patch; should be a minor bump at minimum.

**How to fix.** Bump `package.json` to the correct version (major for breaking, minor for additive) and re-run. If the diff is wrong, the baseline may be stale — `sitely build --publish` rotates the baseline at release time.

**Baseline source.** The default baseline is the committed `dist/baseline-manifest.json`. Pass `--baseline npm` to diff against the latest published version on the npm registry instead — useful when the committed file is suspected to have drifted out of sync with what's actually on npm. See [framework-build → baseline source](/architecture/framework-build#baseline-source-for-semver-discipline).

**Strict-by-default in both directions.** A breaking change without a major bump fails the check; an additive change without at least a minor bump also fails. Pass `--allow-missing-minor-bump` to demote the additive-without-minor case to a warning — useful when you're batching multiple additive changes into the next major release.

**First release.** If `dist/baseline-manifest.json` doesn't exist (first publish), the check passes trivially. The first run after `npm publish` writes the baseline.

## Warning-only checks

A handful of checks run alongside the eight but only warn instead of failing. They surface things that are usually worth looking at, but aren't strict enough to block [verified](/overview/glossary#verified) status on their own.

- **Performance budget.** A fixture's extraction wall time is above an internal soft budget. The hard wall is the framework's `extractTimeoutMs` (default 30s); this warning fires earlier so you notice slow extractors before they hit the real ceiling.
- **TTL plausibility.** A resource's `ttl.default` looks off for the kind of content — for example, 30 days for a news feed or 5 seconds for an evergreen reference page. Plausibility is a heuristic; the hard wall is the `min`/`max` bounds you declare on the same resource.
- **Fixture freshness.** A fixture's `meta.json` records a `fetchedAt` older than 90 days. Warn at 90, hard fail at 365 — at some point a fixture is just an old snapshot of a site that no longer looks anything like that.
- **Fixture coverage.** For any field marked `.optional()` / `.nullable()` / `.nullish()` in a resource's schema, fixtures must collectively cover both present and absent cases. Warns when one case isn't tested.

Warnings show up in `sitely test` output prefixed with `warn:` and don't change the exit code. CI can choose to fail on warnings with `sitely test --strict`.

## What the human review covers

Three things automation can't see well are checked by a human reviewer before a package version moves to [verified](/overview/glossary#verified):

1. **Selector fragility.** Brittle XPath, deeply-coupled cosmetic class names, selectors that depend on element position rather than meaning. None of these fail today; all of them break the next time the site changes its layout. A reviewer flags these so the author can decide whether to harden them now.

2. **Identity bucket assignment.** Reviewer picks the [identity bucket](/overview/glossary#identity-bucket) — reputable, gray, or hostile — that the package's target site falls into. This is routing information for consumers, not a moral judgement.

3. **README sanity.** A working README with a five-line quickstart and a clear "what this package extracts" description. Missing or misleading docs block the verified status, even if every automated check passes.

Out of scope for the human reviewer: code style, variable naming, schema design choices, "I'd have written this differently." Reviewers don't second-guess the author on subjective ground — they look only at the three things above.

## FAQ and edge cases

**What if I want to skip a check temporarily during development?**

Use `sitely test --skip <name>`. The skip applies only to local runs; CI rejects `--skip` and runs the full suite. The verified status requires all eight passing without skips.

**What if my package fails `determinism` only on one machine?**

Check for locale-dependent number or date formatting that varies by OS locale, time-zone-dependent date parsing, and any `Date.now()` you might have missed. If you can't reproduce it elsewhere, run the test twice in `--verbose` mode on the failing machine and diff the two outputs.

**What if my fixture is huge and the performance-budget warning fires?**

The warning is per-fixture. Trim the fixture HTML down to the smallest version that still reproduces the extraction path you care about. Removing inlined CSS, fonts, and analytics blobs usually drops fixture size by an order of magnitude without changing extractor behaviour.

**What if I need to test against live HTML instead of a committed fixture?**

`sitely test --live <fixture-name>` re-fetches the URL recorded in `<name>.meta.json` and runs the suite against the live HTML. Use this for interactive iteration while a site is changing under you. CI always runs against committed fixtures, never live, so the test result is reproducible.

**What if `schema-emission-roundtrip` keeps failing on a refinement?**

JSON Schema can't express arbitrary JavaScript refinements. Either replace the refinement with a standard keyword (`pattern`, `format`, `multipleOf`, …), loosen the runtime schema to match what JSON Schema can describe, or accept the gap and document it in the field's `description`. There isn't a fourth option.

**What if `semver-discipline` fails after I think I made a non-breaking change?**

The diff between `dist/manifest.json` and `dist/baseline-manifest.json` is showing something you didn't expect. Inspect the diff manually: a schema field whose order changed counts as a change, a TTL adjusted from `1h` to `30m` counts. Either bump the version to reflect the change, or revert if it wasn't intentional.

**What if a fixture passes locally but fails in CI?**

The usual cause is uncommitted output: either `<hash>.expected.json` or `dist/manifest.json` is newer than what's in git. Run `git status` after a clean `sitely test && sitely build` locally and commit anything that changed.

## How tests run

`sitely test` runs every check in-process — site code and the harness execute in the same Node process. There's no isolation layer; the operator's `package-lock.json` is the trust boundary, the same as any npm dependency.

Practical consequences:

- A timeout (`extractTimeoutMs`, default 30s) wraps each extract call so a hung selector doesn't block the harness.
- The test runner catches thrown [framework errors](/overview/glossary#framework-errors) (`RateLimitedError`, `BlockedError`, etc.) and surfaces them as the appropriate result variant — so an extractor that throws to signal a known bad-response shape is handled the same way at test and at runtime.
- A managed/hosted runtime would add real isolation at the service layer. See [future direction](/future/).

## How statuses move

The eight checks plus the human review feed directly into the package version's [status](/overview/glossary#status) shown in the directory.

A newly-published version starts at [unverified](/overview/glossary#unverified). When all eight checks pass and the human review completes without blocking issues, the status moves to [verified](/overview/glossary#verified). Any check failure keeps the status at unverified until the next publish.

After verification, live-traffic monitoring continues. If sampled extractions start diverging from the declared behaviour — selectors returning empty results, schema-conformance dropping on real URLs — the status moves to [drift suspected](/overview/glossary#drift-suspected). The package keeps working; consumers see a warning in the directory. Publishing a new version that passes the full suite against current live HTML clears the warning.

Status is per-version. A package taken to [removed](/overview/glossary#removed) doesn't taint its successors: the next published version starts at unverified and runs through the whole suite again.
