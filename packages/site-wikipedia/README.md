# @sitely/site-wikipedia

The Wikipedia canary site definition. v0's reference implementation of an atlas-§10 community-site package.

## What this is

A real, publishable site definition that doubles as the framework's end-to-end integration smoke test. Whenever framework primitives change, this package's `sitely build && sitely test` is what proves the contract still holds.

The canary covers the locale-in-host case (per atlas spec §3) — `{locale}.wikipedia.org` resolves into separate origins for `en`, `de`, and `fr` — so the framework's locale-matrix code path has real fixtures to run against.

## Layout

Per atlas §10 canonical layout:

```
packages/site-wikipedia/
├── index.ts                          DSL v2 site definition
├── package.json                      @sitely/site-wikipedia (private, workspace)
├── tsconfig.json                     extends ../../tsconfig.json
├── fixtures/
│   ├── en/
│   │   ├── typescript.html           happy-path fixture (real Wikipedia HTML)
│   │   ├── typescript.expected.json  expected extract() output, computed from real run
│   │   ├── typescript.meta.json      status / headers / fetchedAt sidecar
│   │   ├── missing-article.error.html  error-path fixture (Wikipedia "noarticletext")
│   │   ├── missing-article.error.json  error-path declaration
│   │   └── missing-article.meta.json   sidecar
│   ├── de/typescript.{html,expected.json,meta.json}   author-synthetic — see TODO in HTML head
│   └── fr/typescript.{html,expected.json,meta.json}   author-synthetic — see TODO in HTML head
└── dist/                             ← only manifest.json + schemas/ are tracked; *.js is gitignored
    ├── manifest.json                 emitted by `sitely build` — INTENTIONALLY COMMITTED (atlas §0)
    └── schemas/Article.json          emitted JSON Schema for the Article validator
```

## Why `dist/manifest.json` is committed (atypical)

Most TypeScript packages gitignore `dist/` entirely. This one ships the keystone artifacts — `dist/manifest.json` and `dist/schemas/*.json` — under version control, while compiled JS (`dist/*.js`, `dist/*.d.ts`, source maps) stays gitignored. The repo's [`.gitignore`](../../.gitignore) narrows the exception to exactly those two paths.

Why: **the `manifest-integrity` CI check requires the manifest to be tracked**. Atlas spec §0 makes the build-time manifest the keystone primitive — the static artifact that downstream consumers (directory rendering, runner cross-check, capability sandbox) read at install time without executing the package. The integrity check is:

> Re-run `sitely build`. Diff the freshly-built manifest against the committed `dist/manifest.json`. If they differ, the package was published with a stale manifest — fail the build.

For that diff to mean anything, the previous manifest has to be in version control. So `packages/site-wikipedia/dist/manifest.json` and `dist/schemas/*.json` are committed deliberately.

Compiled JS (`dist/*.js`) is NOT shipped — installers run `tsc` themselves (`pnpm exec tsc` or via the package's `pnpm build` script, which chains `tsc && sitely build`). The framework's site-def loader will pick up `dist/index.js` when it exists locally, but it isn't part of the package's published surface.

Determinism contract: regenerating the manifest against the same authored sources must produce byte-identical output. Verified end-to-end:

```bash
cp dist/manifest.json /tmp/m1.json
sitely build
diff /tmp/m1.json dist/manifest.json   # → empty
```

If your CI fails on `manifest-integrity`, re-run `sitely build` locally and commit the regenerated `dist/manifest.json`.

## Running the canary

```bash
cd packages/site-wikipedia
pnpm exec sitely build   # tsc + emit dist/manifest.json + dist/schemas/Article.json
pnpm exec sitely test    # all 8 must-pass CI checks (atlas spec §9)
```

Expected `sitely test` output:

```
✓ fixture-extraction (3 items)         en/de/fr articles match expected.json
✓ schema-conformance (3 items)         Standard Schema Article validates
✓ determinism (3 items)                byte-identical across two runs
✓ schema-emission-roundtrip (3 items)  Ajv2020 against dist/schemas/Article.json
✓ locale-matrix (1 item)               page has fixtures for ≥2 of [en,de,fr]
✓ error-path-coverage (1 item)         missing-article.error.html validate=false
✓ manifest-integrity (1 item)          re-build vs committed dist/manifest.json
✓ security-sandbox (3 items)           no capability violations across happy path
```

`pnpm test` in this package runs `sitely test` directly (no separate vitest layer — the 8 checks ARE the test contract).

## Refreshing fixtures

Today's en fixture is a real (small) Wikipedia HTML capture. The de/fr fixtures are author-synthetic — structurally faithful but not real-network captures. Each carries a TODO comment in its `<head>` pointing at the exact `sitely snapshot` invocation to refresh it once network access is available:

```bash
sitely snapshot https://de.wikipedia.org/wiki/TypeScript --locale de --name typescript
sitely snapshot https://fr.wikipedia.org/wiki/TypeScript --locale fr --name typescript
```

After refresh: re-run the extraction one-shot to regenerate the corresponding `expected.json`, then `sitely build` to refresh the manifest, commit the result.

## See also

- [`@sitely/framework`](../framework/README.md) — the DSL, primitives, CLI, and 8 must-pass check definitions.
- [`@sitely/schemas`](../schemas/README.md) — the Zod-based Standard Schema validators (`Article` is the one this canary uses).
- Atlas framework architecture spec — task #4e9dc8fa, comment `86f06dff` (main) + `fe016553` (addendum 1) + `b99e00b2` (addendum 2). Sections §0 (manifest), §3 (locales), §8 (capabilities), §9 (8 must-pass checks), §10 (canonical layout) all apply directly.
