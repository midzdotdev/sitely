# @sitely/framework

The DSL, primitives, CLI, and 8 must-pass CI checks that turn a website into a structured, deterministic data source.

## What sitely is

A site definition is a TypeScript module that declares how to extract structured data from a website. The framework gives you:

- A typed DSL (`defineSite`) for the declaration.
- A build pipeline that emits a static manifest + JSON Schemas (`buildPackage`) per atlas spec §0.
- A test harness that runs 8 must-pass CI checks against the package's fixtures inside a capability-constrained `worker_threads` sandbox (`testPackage`).
- A thin CLI (`sitely`) that wraps the primitives.
- A reusable GitHub Actions workflow community sites consume in one line.

The architecture trace lives in atlas's framework spec — see [`architecture.md`](../../architecture.md) and the spec under task #4e9dc8fa (comments `86f06dff` / `fe016553` / `b99e00b2`).

## Quickstart

A complete site definition. The Wikipedia canary at [`packages/site-wikipedia/index.ts`](../site-wikipedia/index.ts) is the worked-example reference for everything below — it exercises every section of the DSL except `family`.

```ts
import { defineSite } from "@sitely/framework";
import { Article } from "@sitely/schemas";

export default defineSite({
  site: {
    id: "wikipedia",
    displayName: "Wikipedia",
    homepage: "https://www.wikipedia.org/",
  },

  origins: [{ hostname: "{locale}.wikipedia.org", templated: true }],

  locales: {
    source: "host",
    values: ["en", "de", "fr"],
    default: "en",
  },

  rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },

  capabilities: {
    network: { egress: "site-only" },
    filesystem: "none",
    process: "none",
    timers: { maxWallMs: 30_000 },
    memory: { maxMb: 256 },
  },

  framework: { minVersion: "0.1.0", maxVersion: "1.0.0" },

  schemas: { Article },

  resources: {
    article: {
      schema: "Article",
      params: { title: { type: "string", required: true } },
      resolve: (p) => `/wiki/${encodeURIComponent(p.title)}`,
      ttl: { default: "24h", min: "1m", max: "30d" },
    },
  },

  pages: {
    "/wiki/:title": {
      provides: ["article"],
      examples: [
        "https://en.wikipedia.org/wiki/TypeScript",
        "https://de.wikipedia.org/wiki/TypeScript",
      ],
      validate: (ctx) => ctx.$("#content")?.exists() === true,
      extract: async (ctx) => ({
        article: { headline: ctx.$("#firstHeading")?.text() ?? "" },
      }),
    },
  },
});
```

Then:

```bash
pnpm exec sitely build   # tsc + emit dist/manifest.json + dist/schemas/Article.json
pnpm exec sitely test    # run all 8 must-pass CI checks
```

## The DSL — `defineSite()`

`defineSite(config)` is an identity function that preserves type inference. Every field below is type-checked against `SiteDefinition` in [`src/types.ts`](src/types.ts).

### `site`

```ts
site: { id: string; displayName: string; homepage?: string }
```

`id` is the canonical scoped identifier (e.g. `"wikipedia"`). Resource IDs are scoped as `<id>:<resource>` (atlas §2). `displayName` is the human-readable name for the directory. `homepage` is optional metadata.

### `origins`

```ts
origins: Array<{ hostname: string; templated?: boolean }>
```

Where the site lives. For locale-templated origins (atlas §3), set `templated: true` and use `{locale}` in `hostname`; the framework expands it against `locales.values`.

- Locale-in-host: `[{ hostname: "{locale}.wikipedia.org", templated: true }]` → 3 origins for en/de/fr
- Locale-in-path: `[{ hostname: "example.com" }]` (one origin shared across locales)
- Multi-host without locale: `[{ hostname: "example.com" }, { hostname: "example.org" }]`

### `locales`

```ts
locales?: { source: "host" | "path" | "query"; values: string[]; default: string }
```

Optional. When declared, every cache key includes the locale. `source` declares where the locale appears in URLs:

- `"host"` — hostname carries it (`en.wikipedia.org`). N origins, N robots.txt fetches.
- `"path"` — URL path carries it (`/en/...`). 1 origin, 1 robots.txt.
- `"query"` — query parameter carries it (`?lang=en`). 1 origin, 1 robots.txt.

The locale model assumes a uniform host template (atlas addendum-2 §3): mixed-host sites where some hosts are locale-templated and others aren't should be split into separate site packages.

`default` must be in `values` — `sitely build` errors with `missing-locale-default` otherwise.

### `schemas`

```ts
schemas: Record<string, StandardSchemaV1>
```

Top-level map of Standard Schema validators (typically Zod, from [`@sitely/schemas`](../schemas/README.md)). Resources reference these by name via `resources[*].schema`. Each entry is emitted as JSON Schema to `dist/schemas/<Name>.json` at build time.

```ts
import { Article } from "@sitely/schemas";
schemas: { Article },
```

Custom schemas allowed — declare your own Zod object and add it to the map. The manifest tags it `schemaOrgType: null`.

### `resources`

```ts
resources: Record<string, ResourceDef>

interface ResourceDef {
  schema: string;                                  // string ref into site.schemas
  params: Record<string, ParamDef>;
  resolve: (params: Record<string, string>) => string;
  ttl: { default: string; min: string; max: string };
}
```

A resource is a named, schema-typed thing the site can produce. The string `schema` field references an entry in the top-level `schemas` map; the framework refuses to build if it doesn't resolve (`missing-schema-ref` error).

`resolve(params)` builds the URL path from required params. `params[*]` declares parameter type (`"string"` or `"number"`) and whether it's required.

#### TTL triple

```ts
ttl: { default: "24h"; min: "1m"; max: "30d" }
```

Per atlas §5: `default` is the cache TTL applied unless a client overrides; client overrides are clamped to `[min, max]`. Sanity bounds enforced at build:

- `min` ≥ 1s
- `max` ≤ 30d
- `min` ≤ `default` ≤ `max`

Duration string format: `<digits><s|m|h|d>`. Anything else fails with a `ttl` validation error.

### `pages`

```ts
pages: Record<string, PageDef>      // keyed by URL pattern, e.g. "/wiki/:title"

interface PageDef {
  provides: string[];                      // resource names from site.resources
  examples: string[];                      // representative URLs (locale-bearing if locales:host)
  fixtures?: string[];                     // optional explicit paths to fixture HTML
  validate: (ctx) => boolean;              // does this page look real?
  extract: (ctx) => Promise<Record<string, unknown>>;
  paginate?: PaginateDef;                  // optional next-page extraction
}
```

`validate(ctx)` distinguishes a real page from a 404 / captcha / stub. Returning `false` is also what the `error-path-coverage` check expects against `<name>.error.html` fixtures (atlas §9 #6).

`extract(ctx)` returns an object keyed by resource name. The resource's schema validator runs against each extracted value during the `schema-conformance` check (atlas §9 #2).

Page examples must use a locale that appears in `locales.values` when `locales.source === "host"` — `sitely build` flags `page-example-not-in-locale-set` otherwise.

### `capabilities`

```ts
capabilities?: {
  network?: { egress: "site-only" | "any" | "none" };
  filesystem?: "none" | "read-temp" | "read-write-temp";
  process?: "none";
  timers?: { maxWallMs: number };
  memory?: { maxMb: number };
}
```

Optional. Defaults from atlas §8 (applied via `resolveCapabilities()` if missing):

| Field | Default |
|---|---|
| `network.egress` | `"site-only"` |
| `filesystem` | `"none"` |
| `process` | `"none"` |
| `timers.maxWallMs` | `30_000` |
| `memory.maxMb` | `256` |

The test harness enforces these — see [Capabilities & sandbox](#capabilities--sandbox).

### `framework`

```ts
framework?: { minVersion?: string; maxVersion?: string }
```

Compatibility range for the runner to consume. Per atlas addendum-2 §6: missing range = caret-compatible (`^x.y.z`) with the framework version listed in your `package.json` `dependencies`. Declaring an explicit range is recommended.

### `family`

```ts
family?: {
  origins: Array<{ hostname: string; display?: string; rateLimit?: Partial<RateLimitConfig> }>;
  structuralIdentityCheck: string;     // path to fixture used to assert origins share shape
}
```

Optional. **You probably don't want this.** The recommended default (atlas §4) is one site package per origin / brand. Family packages are reserved for true networks where every origin renders identical structural HTML (Stack Exchange-style). Reddit subdomains, Shopify stores, WordPress instances are NOT family — they need per-origin packages or shared util libs.

If you do declare `family`, `structuralIdentityCheck` points at a fixture used by CI to assert each declared origin matches the same selectors.

### `rateLimit`, `normalizeUrl`, `crawl`

```ts
rateLimit: { maxConcurrent: number; requestsPerSecond: number; scope?: "origin" | "site" }
normalizeUrl?: (url: string) => string
crawl?: { enabled: boolean; respectRobotsTxt?: boolean; maxDepth?: number; filterLinks?: (url) => boolean }
```

`rateLimit` defaults `scope: "origin"`; use `"site"` when locale-in-host servers all sit behind one CDN. `normalizeUrl` is called before cache lookup (strip tracking params, fragments). `crawl` configures background discovery — opt-in.

## Framework primitives

All four primitives live in [`src/build/`](src/build/) (except `testPackage`, which lives in [`src/test-pkg/`](src/test-pkg/)). The CLI wraps them; you can also call them directly from a custom CI script or a hosted runner.

### `buildPackage(opts)` → `BuildPackageResult`

```ts
buildPackage({ packageRoot: string; dryRun?: boolean; tool?: string }): Promise<BuildPackageResult>
```

Loads the site def, runs `validateSite`, and emits `dist/manifest.json` + `dist/schemas/<Name>.json`. On validation failure returns `{ ok: false, errors }` with nothing written. With `dryRun: true`, returns the manifest + serialized JSON without touching disk.

→ [`src/build/index.ts`](src/build/index.ts)

### `validatePackage(opts)` → `ValidatePackageResult`

```ts
validatePackage({ packageRoot: string }): Promise<ValidatePackageResult>
```

Same `validateSite` checks as `buildPackage` minus the artifact emission. Watch-mode-friendly. Use during authoring for fast feedback.

→ [`src/build/validate-package.ts`](src/build/validate-package.ts)

### `testPackage(opts)` → `TestPackageResult`

```ts
testPackage({ packageRoot: string; only?: CheckName[] }): Promise<TestPackageResult>
```

Runs the 8 must-pass CI checks (atlas §9) against the package's fixtures. Returns per-check results + aggregated failures. Use `only` to subset (e.g. skip `manifest-integrity` during fast iteration).

→ [`src/test-pkg/index.ts`](src/test-pkg/index.ts)

### `snapshotUrl(opts)` → `SnapshotResult`

```ts
snapshotUrl({
  url: string;
  packageRoot: string;
  locale?: string | null;
  name?: string;
  userAgent?: string;
  skipIfExists?: boolean;
}): Promise<SnapshotResult>
```

Fetches a live URL and persists it as `fixtures/<locale>/<name>.html` + sibling `<name>.meta.json` per atlas §10 layout. Skips the network call when the fixture already exists (default). 4xx/5xx responses are written too — they feed the `error-path-coverage` check.

→ [`src/build/snapshot.ts`](src/build/snapshot.ts)

## CLI — `sitely`

Thin wrappers over the primitives. Every per-package command defaults to the current working directory; `--package <path>` operates on a specific package; `--all` walks both `sites/*` (legacy) and `packages/site-*` (canonical, atlas §10).

```
sitely build    [--package <path>] [--all]
sitely test     [--package <path>] [--all]
sitely check    [--package <path>] [--all]
sitely validate [--package <path>] [--all]      ← alias for `check`
sitely snapshot <url> [--locale <l>] [--name <slug>] [--package <path>]
sitely init <domain>                            ← scaffold a new site under sites/
sitely fetch-fixtures [domain]                  ← legacy bulk-fetch (writes fixtures.json)
sitely openapi [--output file]                  ← generate OpenAPI 3.1 spec
```

### Command details

| Command | Primitive | Pass | Fail |
|---|---|---|---|
| `sitely build` | `buildPackage` | exits 0, writes `dist/manifest.json` + `dist/schemas/*.json` | exits 1, prints `[<kind>] <message>` per validation error, no files written |
| `sitely test` | `testPackage` | exits 0, prints `✓ <check> (N items)` per check | exits 1, prints `✗ <check>` + per-failure detail (jest-diff for fixture/determinism check failures) |
| `sitely check` | `validatePackage` | exits 0 | exits 1, prints validation errors |
| `sitely snapshot` | `snapshotUrl` | exits 0, writes HTML + meta.json | exits 1 with `fetch failed` message |

### `sitely test` ↔ vitest

Authors coming from generic-vitest projects: there is no separate vitest path. `sitely test` IS the test contract — it runs vitest internally as the runner for the worker isolation, but you don't write `.test.ts` files. Atlas spec §7 binds: "the framework-provided test harness implements all 8 of crucible's must-pass checks."

If you want to run vitest unit tests on extractor helpers, do that under a `__tests__/` subdirectory in your package — they're orthogonal to the 8 must-pass checks.

### CI = `sitely build && sitely test`

That's the entire community-site CI contract. The reusable workflow at [`.github/workflows/site-ci.yml`](../../.github/workflows/site-ci.yml) is what community-site repos consume in one line.

## The 8 must-pass CI checks

Per atlas §9. Every check has a discrete `run<Name>` function in [`src/test-pkg/checks.ts`](src/test-pkg/checks.ts).

| # | Name | What it tests | Typical fix when it fails |
|---|---|---|---|
| 1 | `fixture-extraction` | `extract(fixture)` matches sibling `expected.json` | Update `expected.json` (intentional output change) or fix the extractor (regression) |
| 2 | `schema-conformance` | Extracted output validates against the declared Standard Schema | Tighten the extractor or extend the schema with `.extend()` |
| 3 | `determinism` | Run extract twice, byte-compare via stable serialization | Remove non-determinism from the extractor (`Date.now()`, Set/Map iteration order, async race) — failure includes a jest-diff of run 1 vs run 2 |
| 4 | `schema-emission-roundtrip` | Ajv2020 validates extract output against the emitted `dist/schemas/<Name>.json` | The Zod-to-JSON-Schema adapter has drift, or you used a Zod feature with no JSON Schema mapping |
| 5 | `locale-matrix` | Sites with ≥2 locales declared have fixtures for ≥2 locales per page | Capture another locale's fixture via `sitely snapshot --locale <l>` |
| 6 | `error-path-coverage` | `<name>.error.html` fixtures must `validate()` to `false` | Tighten the validator so it correctly rejects the error page; if no error fixtures exist, this check warns rather than fails |
| 7 | `manifest-integrity` | Re-build dryRun, diff against committed `dist/manifest.json` | Run `sitely build` locally and commit the regenerated manifest |
| 8 | `security-sandbox` | Aggregates capability violations across happy-path fixtures | Stop reaching for capabilities the manifest doesn't declare (raw `node:fs`, off-domain `fetch`, etc.) |

`sitely test` reports per-check `ok: true/false` + a count of items each check ran against. Failures include structured detail (validator errors, jest-diff output, capability violation specifics).

## Capabilities & sandbox

Per atlas §8: **the test harness IS the sandbox.** Per-fixture extraction runs inside a `worker_threads.Worker` with:

- `globalThis.fetch` overridden with an allowlist driven by `manifest.capabilities.network.egress` + `getAllHostnames(site)`.
  - `"site-only"`: only the site's declared origins (locale-expanded) are reachable.
  - `"any"`: no restriction.
  - `"none"`: any fetch attempt fails.
- `resourceLimits.maxOldGenerationSizeMb` from `capabilities.memory.maxMb`.
- In-worker `setTimeout(maxWallMs)` deadline + outer parent watchdog with `maxWallMs + 5s` slack.

Capability violations propagate as `{kind: "capability-violation", capability, attempted}` and turn into test failures (atlas §9 #8).

**What's NOT enforced today** (future work — see [`src/test-pkg/worker.ts`](src/test-pkg/worker.ts) docstring): module deny-list for `node:fs`, `node:fs/promises`, `node:child_process`, `node:vm`, `node:net`, `node:dgram`, `node:tls`. An extractor that calls `fs.readFile()` directly will succeed silently rather than fail. This will be wired when the first community submission needs filesystem-allowed extraction.

**Honest caveat (atlas §8):** worker_threads is process-internal. A determined attacker can escape via native addons or runtime tricks. The harness catches accidents and lazy mistakes, not adversaries. Real adversary defense is the deferred managed-service trust pass.

## Manifest — `dist/manifest.json`

The keystone primitive (atlas §0). Static, build-time JSON document emitted alongside the package's runtime code. Single source of truth for everything CI checks, everything the directory renders, everything the runner cross-checks at startup.

### Shape

```jsonc
{
  "manifestVersion": "1",
  "packageName": "@sitely/site-wikipedia",
  "packageVersion": "0.1.0",
  "site": { "id": "wikipedia", "displayName": "Wikipedia", "homepage": "..." },
  "origins": [{ "hostname": "{locale}.wikipedia.org", "templated": true }],
  "locales": { "source": "host", "values": ["en", "de", "fr"], "default": "en" },
  "resources": {
    "article": {
      "schemaRef": "Article",
      "params": { "title": { "type": "string", "required": true } },
      "ttl": { "default": "24h", "min": "1m", "max": "30d" },
      "providedBy": ["page:/wiki/:title"]
    }
  },
  "pages": {
    "/wiki/:title": {
      "provides": ["article"],
      "examples": ["https://en.wikipedia.org/wiki/TypeScript", "..."]
    }
  },
  "schemas": {
    "Article": {
      "$ref": "./schemas/Article.json",
      "schemaOrgType": "Article",
      "schemaOrgVersion": "27.0"
    }
  },
  "capabilities": {
    "network": { "egress": "site-only" },
    "filesystem": "none",
    "process": "none",
    "timers": { "maxWallMs": 30000 },
    "memory": { "maxMb": 256 }
  },
  "framework": { "minVersion": "0.1.0", "maxVersion": "1.0.0" },
  "build": { "commit": "abc1234", "builtAt": "2026-05-08T12:00:00+00:00", "tool": "sitely-cli@0.1.0" }
}
```

### Per-field provenance

| Manifest field | Populated from |
|---|---|
| `manifestVersion` | Constant `"1"` |
| `packageName` / `packageVersion` | Package's `package.json` |
| `site.*` | Site def's `site` field, verbatim |
| `origins[]` | Site def's `origins` field; only `hostname` + `templated: true` (when set) emitted |
| `locales` | Site def's `locales` field, verbatim (omitted when undeclared) |
| `resources[*].schemaRef` | Site def's `resources[*].schema` (string) |
| `resources[*].params` / `ttl` | Site def's resource verbatim |
| `resources[*].providedBy` | Derived from `pages[*].provides` |
| `pages[*]` | Function bodies stripped; only `provides`, `examples`, `fixtures?` carried |
| `schemas[*].$ref` | `./schemas/<Name>.json` |
| `schemas[*].schemaOrgType` / `schemaOrgVersion` | `schemaOrgMetadata` from `@sitely/schemas`; `null` for custom schemas |
| `capabilities` | `resolveCapabilities(site)` — declared values, atlas §8 defaults applied for missing fields |
| `framework` | Site def's `framework` field (`{}` when undeclared; runner applies caret-compat fallback) |
| `family?` | Site def's `family` field (omitted when undeclared) |
| `build.commit` | `git rev-parse --short HEAD` |
| `build.builtAt` | `git show -s --format=%cI HEAD` (committer ISO of HEAD — NOT `Date.now()`) |
| `build.tool` | CLI version string (e.g. `"sitely-cli@0.1.0"`) |

### Why determinism matters

The `manifest-integrity` check (atlas §9 #7) regenerates the manifest and diffs it against the checked-in `dist/manifest.json`. If they differ, the package was published with a stale manifest. For that to be a meaningful test, regeneration must be byte-identical. So the build:

- Reads timestamps from git (committer ISO of HEAD), never `Date.now()`.
- Sorts every object key via `fast-json-stable-stringify` before serializing.
- Serializes JSON Schemas via Zod 4's `z.toJSONSchema()` (deterministic).
- Forbids `process.env`-derived fields entirely.

A self-test invariant in [`src/build/build.test.ts`](src/build/build.test.ts) regenerates the manifest twice and asserts byte-identity — the determinism contract is structurally protected against regression.

## Error message contract

Every framework error (validation, capability violation, missing schema ref, etc.) names:

1. The concrete value or location that caused it.
2. The site / page / resource / fixture context.
3. A one-line fix when the cause is unambiguous.

This is a constitutional rule, not a style suggestion. Authors fix what they can read, and "Validation failed" with no context means they can't.

## No telemetry

The framework, the CLI, and `@sitely/schemas` make zero outbound network calls except:

- `sitely snapshot <url>` (explicit user action)
- The site's own `extract(ctx)` if it calls `ctx.fetch(...)` (sandboxed via the capability allowlist)

No analytics, no version checks, no error reporting. Trust is earned early or not at all.

## Glossary

- **Site** — A domain or family of domains modeled as a single package. Has an `id` (canonical scope) and one or more `origins`.
- **Origin** — A hostname the site is reachable at. Locale-templated origins use `{locale}` substitution.
- **Locale** — A language/region tag (`en`, `de`, `fr`, ...). When declared, every cache key includes it.
- **Resource** — A schema-typed thing the site can produce (e.g. `wikipedia:article`). Identified by `<site.id>:<resource>` scoped name.
- **Page** — A URL pattern (e.g. `/wiki/:title`) that knows how to extract one or more resources. Owns `validate` + `extract`.
- **Fixture** — A captured HTML page used as the input to the test harness. Lives at `fixtures/<locale>/<name>.html` per atlas §10.
- **Capability** — A constraint declared in the manifest and enforced by the test harness (`network`, `filesystem`, `process`, `timers`, `memory`).
- **Manifest** — The static `dist/manifest.json` artifact. Emitted by `sitely build`; consumed by directory rendering, runner startup, and the integrity check.
- **Family** — A package that covers multiple structurally-identical origins (Stack Exchange-style). Rare; per-origin packages are the recommended default.

## Public surface (exports)

| Export | Kind | Purpose |
|---|---|---|
| `defineSite` | function | Type-safe site definition builder |
| `buildPackage` | function | Emit `dist/manifest.json` + `dist/schemas/*.json` |
| `validatePackage` | function | Fast static validation (no fixture execution) |
| `testPackage` | function | Run all 8 must-pass CI checks |
| `snapshotUrl` | function | Capture a URL as a fixture |
| `urlToFixtureName` | function | Derive a fixture filename from a URL |
| `resolveCapabilities` | function | Apply atlas §8 defaults to a site's capability declarations |
| `parseTTL` / `validateTTL` | function | TTL duration parsing + sanity-bound checks |
| `stableSerialize` | function | Deterministic JSON stringify for manifest-style artifacts |
| `getActiveOrigins` / `getAllHostnames` / `getPrimaryHostname` | function | Locale-aware hostname derivation |
| `createExtractContext` / `createTestContext` | function | Build an `ExtractContext` from a `PageDriver` or raw HTML |
| `matchPagePattern` / `matchPattern` | function | Match a URL to a page pattern |
| `testExtract` | function | Legacy single-fixture validate+extract helper |
| `extractJsonLd` / `filterJsonLdByType` | function | Parse JSON-LD blocks from a page |
| `parseRobotsTxt` | function | Parse robots.txt into a checker |
| `generateOpenApiSpec` | function | Generate OpenAPI 3.1 from loaded site definitions |
| `DEFAULT_CAPABILITIES` | constant | Atlas §8 capability defaults |
| `SiteDefinition`, `Manifest`, `BuildPackageResult`, `TestPackageResult`, `CheckResult`, `CheckFailure`, `CheckName`, `ValidationError`, `Origin`, `LocaleConfig`, `CapabilityConfig`, `FrameworkRange`, `FamilyConfig`, `ResourceTTL`, `SiteIdentity`, `StandardSchemaV1`, ... | type | Public types |

Vitest-dependent helpers (`createFixtureLoader`, `describePageExtraction`, `loadFixtureManifest`) live in `@sitely/framework/testing` to avoid pulling vitest into runtime imports.

## See also

- [`@sitely/schemas`](../schemas/README.md) — the Zod-based Standard Schema validators referenced from `site.schemas`.
- [`@sitely/site-wikipedia`](../site-wikipedia/README.md) — the canary site, worked example for everything in this README.
- [`@sitely/page`](../page/README.md) — the DOM abstraction (`PageDriver`, `PageElement`, `CheerioDriver`) used by `ExtractContext`.
- [`architecture.md`](../../architecture.md) — high-level system architecture.
- Atlas framework spec — task #4e9dc8fa, comments `86f06dff` (main, 12 sections) + `fe016553` (addendum 1) + `b99e00b2` (addendum 2). Every section heading in this README cross-references the relevant spec section.
