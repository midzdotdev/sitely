# The manifest

`dist/manifest.json` is the file every layer of sitely either produces, reads, or verifies. Every [site package](/overview/glossary#site-package) ships one. The [build](/overview/glossary#build) writes it; the test suite re-derives it and diffs against the committed copy; the server reads it on load; downstream tools (directory, drift detection, signing) read it. This page documents its shape, what each field means, and the determinism rules that make it diffable.

The type definition is `Manifest` in `packages/framework/src/build/manifest-types.ts`. The wire format is JSON, sorted lexicographically by key.

## Why a manifest

Three things would be hard without it:

1. **Directory rendering.** A directory shows schemas, locales, resources, and rate-limit declarations for many packages. Reading the source `.ts` of each is impractical. The manifest is the declarative summary.
2. **Trust chain.** Signing the source is meaningless (humans can't audit transpiled output); signing the bundle is too coarse. The manifest is what audits attach to. A [future direction](/future/) covers signing in detail.
3. **Server cross-check.** When the server loads a site package, it needs to know which origins and schemas the package claims, plus its `version`, *before* executing any code. The manifest provides that. The server can refuse to load a package whose manifest is inconsistent with the running framework or operator policy.

## The shape

```ts
interface Manifest {
    manifestVersion: "1";
    packageName: string;
    packageVersion: string;
    site: ManifestSite;
    origins: ManifestOrigin[];
    locales?: ManifestLocales;
    resources: Record<string, ManifestResource>;
    pages: Record<string, ManifestPage>;
    schemas: Record<string, ManifestSchema>;
    framework: ManifestFramework;
    family?: {
        origins: Array<{ hostname: string; display?: string }>;
        structuralIdentityCheck: string;
    };
    build: ManifestBuild;
}
```

The `site.version` field comes from `package.json` and is injected by `sitely build`. The client carries it on every typed request; mismatches return `409` (see [Site versioning](./framework-build#site-versioning)).

### `manifestVersion: "1"`

The schema version of the manifest itself. Always `"1"` today. Readers that see a higher version refuse to load rather than assume forward-compatibility — a manifest from a newer framework can carry fields an older reader wouldn't understand.

### `packageName`, `packageVersion`

Mirror the npm package identifiers. Used by the directory to render the package's identity and by any signing chain to bind a manifest to a specific published artifact.

### `site: ManifestSite`

```ts
interface ManifestSite {
    id: string;          // stable identity, e.g. "wikipedia"
    displayName: string; // human-readable, e.g. "Wikipedia"
    homepage?: string;   // canonical site URL for directory display
}
```

The site's **identity**, not its hostname. A multi-locale site has one identity and many origins. The `id` is the namespace prefix for resource identifiers — `wikipedia:article` and `nytimes:article` are different [resources](/overview/glossary#resource) because their site IDs differ.

### `origins: ManifestOrigin[]`

```ts
interface ManifestOrigin {
    hostname: string;
    templated?: boolean;
}
```

The protocol+host pairs the package operates on. Derived from the site definition's `origins` plus its [locale](/overview/glossary#locale) strategy (if any). The server uses this list to dispatch URLs by hostname.

`templated: true` indicates the hostname is a pattern — see [templated origin](/overview/glossary#templated-origin).

### `locales?: ManifestLocales`

```ts
interface ManifestLocales {
    source: "host" | "path" | "query";
    values: string[];
    default: string;
}
```

Present iff the site declares `locales`. Used for cache-key construction ([cache](/overview/glossary#cache) keys always include locale) and for the `locale-matrix` check (multi-locale sites need [fixtures](/overview/glossary#fixture) for at least two declared locales).

### `resources: Record<string, ManifestResource>`

```ts
interface ManifestResource {
    schemaRef: string;
    params: Record<string, ManifestParam>;
    ttl: ManifestTTL;
    providedBy: string[]; // list of page keys
}
```

The set of typed outputs the package can produce. Each resource references a [schema](/overview/glossary#schema) by name (the same name used in `schemas`). `providedBy` is a pre-computed inverse of the `pages → resources` mapping — pre-computed at build so consumers can answer "which [page](/overview/glossary#page) yields this resource?" without traversing all pages.

`ttl` carries the resource's default [TTL](/overview/glossary#ttl) plus min/max bounds. Client TTL overrides are clamped to `[min, max]`; the build refuses to encode TTLs outside the framework's sanity limits.

### `pages: Record<string, ManifestPage>`

```ts
interface ManifestPage {
    urlPattern: string;     // the URL pattern literal (e.g. "/article/:id")
    provides: string[];     // resource names — derived at build time from extract's return keys
    fixtures: Array<{ params: Record<string, string>; errorCase?: boolean }>;
    paginate?: boolean;     // true if the page declared paginate.next
}
```

URL patterns and the resources each one produces. `provides` is derived at build time by dry-running each page's `extract` on its fixtures (the union of returned keys across fixtures); authors don't declare it. `fixtures` mirrors the inline `.page(url, { fixtures: [...] })` declarations from source.

The page's [validate](/overview/glossary#validate) and [extract](/overview/glossary#extract) functions are **not** in the manifest. The manifest carries shapes and identifiers, not behaviour. Behaviour lives in the compiled `dist/index.js`.

### `schemas: Record<string, ManifestSchema>`

```ts
interface ManifestSchema {
    $ref: string;            // path to dist/schemas/<Name>.json
    schemaOrgType: string | null;
    schemaOrgVersion?: string;
}
```

Each schema in the site definition emits a sidecar JSON Schema file. The manifest carries a pointer to the file plus the schema.org type tag, which the directory uses for "which sites provide `Article`?" lookups.

The sidecar files are emitted by `buildPackage()`'s `emitSchemas` step. `$ref` is a relative path, resolved against `dist/`. Readers loading a manifest from npm should follow `$ref` to find the JSON Schema content. Sidecars carry `x-sitely-presence: <rate>` annotations for every `.optional()`, `.nullable()`, `.nullish()` field — see [presence annotation](/overview/glossary#presence-annotation) for the runtime use of the rate.

### `framework: ManifestFramework`

```ts
interface ManifestFramework {
    minVersion?: string;
    maxVersion?: string;
}
```

The semver range of `@sitely/framework` versions the package is compatible with. Set by the author (or scaffolder) at create time; checked by the server at load.

### `family?`

Present iff the package is a multi-origin [family](/overview/glossary#family) (e.g. Stack Exchange across multiple `*.stackexchange.com` hosts). Carries the family origins and the `structuralIdentityCheck` identifier the test suite uses to confirm the origins share literal HTML structure. Per-origin packaging is the default; families are an opt-in case.

### `build: ManifestBuild`

```ts
interface ManifestBuild {
    commit: string;   // package's last source-touching commit
    builtAt: string;  // ISO-8601, set from the commit timestamp, not Date.now()
    tool: string;     // e.g. "@sitely/framework@1.2.3"
}
```

The provenance fields. `commit` is the source-touching commit — *not* `git HEAD`. Unrelated changes elsewhere in the monorepo don't break manifest integrity, because the commit recorded is the last one that touched files under this package. `builtAt` is that commit's author timestamp, not the build wall clock — same source produces the same manifest forever.

## Determinism

The `manifest-integrity` check regenerates the manifest from source and asserts byte-equality with the committed `dist/manifest.json`. This catches:

- Field-order drift (object keys are sorted lexicographically).
- Locale-dependent number/date formatting (pin to UTC, dot-decimal).
- Set/Map iteration order (sort before serialize).
- Build-tool version drift (`build.tool` pins the framework version that built the manifest).
- Wall-clock contamination (no `Date.now()`, no `process.hrtime`).

A manifest that can't be regenerated byte-identically can't be diffed or signed safely. The integrity check is the gate between "this package builds" and "this package is trustable."

## Where the manifest is read

| Reader | What it does with the manifest |
|---|---|
| `sitely test` | Re-runs the build with `dryRun: true`, compares with the committed `dist/manifest.json`. This is the `manifest-integrity` check. Diffs against `dist/baseline-manifest.json` for the `semver-discipline` check. |
| `@sitely/server` site-loader | Cross-checks `origins`, `site.version`, `framework` against runtime expectations. Registers the site by `origins[].hostname`. |
| Directory | Renders `site`, `schemas`, `resources`, `pages` for the package listing. Indexes `schemas.*.schemaOrgType` for cross-package lookups. |
| Signing chain (when present) | The manifest is the document the signature covers; the chain binds signature → commit → npm provenance → tarball. |
| Drift detection (when present) | Compares live extraction shapes against `schemas` to detect divergence between declared and observed behaviour. |

## Where the manifest is **not** read

- **By site code itself.** Site definitions don't read their own manifests. The manifest is for the system; the site definition is the source.
- **Across packages.** One site package doesn't read another's manifest. Cross-package coordination goes through the directory.

## Edge cases

**`manifest.framework.maxVersion` is below the running framework.** The server refuses to load the package and logs which version range was declared versus which framework is running. The operator either upgrades the package or downgrades the framework. The server stays up; only the one site package fails to register.

**`manifest.framework.minVersion` is above the running framework.** Same outcome — the server refuses to load.

**Origins drift between source and the committed manifest.** The `manifest-integrity` check regenerates the manifest from source and diffs. Any origin added, removed, or reordered shows up as a byte-diff and the check fails. The author rebuilds and commits the regenerated `dist/manifest.json`.

**A fixture is checked in but the page that declared it has been deleted.** The build sees the orphan fixture during reverse-indexing (`fixtures?` per page). It rejects with the orphan fixture named. The author either restores the page declaration or removes the fixture file.

**`build.commit` differs between two checkouts of the same repo.** It shouldn't — `build.commit` is the package's last source-touching commit, derived from git history, not the current `HEAD`. If it does differ between checkouts of the same commit, the build is non-deterministic and `manifest-integrity` will fail somewhere. This is the contract: the same source produces the same `build.commit`.

**Two installed site packages declare the same hostname.** The server's site-loader registers them in load order; the later one wins. The loader emits a warning at startup naming both packages. This is a configuration mistake at the operator level — installing two packages for the same site is rarely intended. The server doesn't refuse to start, because the first-registered package is still usable for whatever its hostname covers.

**A `templated: true` origin overlaps a literal origin.** The loader registers the literal one first if both load before any traffic arrives; the templated one matches anything the literal one doesn't. If the loading order is reversed, the literal hostname falls under the templated pattern's package. Operators avoid this by not installing overlapping packages.

**`dist/manifest.json` is missing or unparseable.** The server refuses to load the package and logs the path. The author rebuilds with `sitely build`. `dist/manifest.json` is checked into git for diffing and signing — it isn't generated on install.

**`dist/schemas/<Name>.json` is missing for a schema named in the manifest.** The server refuses to load the package. The sidecar files are part of the build output and must be committed alongside `dist/manifest.json`.

**A `manifestVersion` higher than `"1"` is read by an older framework.** The loader refuses to load and logs the mismatch. Forward-compatibility isn't assumed — a higher version may carry fields the reader doesn't know how to interpret, and silently dropping them would be a footgun.

## Versioning

`manifestVersion: "1"` is the only version today. The fields above are stable. Adding optional fields is non-breaking. Removing, renaming, or changing the semantics of an existing field is a `manifestVersion` bump.
