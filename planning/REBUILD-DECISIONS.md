# Rebuild decisions register

Authoritative resolution layer for turning the docs-as-if-built into a build-ordered
implementation plan. Every conflict/ambiguity surfaced in the doc audit is resolved here.

**Authority order** (higher wins on conflict):

1. `CLAUDE.md` style rules — newest; records post-summary corrections (billing dropped,
   `not_fresh_enough` dropped, `ttl`→`maxAge`, `revoke`→`removed` at all layers).
2. `planning/api-redesign-summary.md` — the redesign decision source-of-truth.
3. Current-docs majority — where ≥3 pages agree.
4. `planning/redesign-followup-plan.md` / `redesign-doc-plan.md` — intermediate; some
   proposals here were later revised (e.g. `not_fresh_enough`). Not authoritative.
5. `planning/CONSTITUTION-PLAN.md` — oldest, non-authoritative.

Status: **Part A** ruled (applying existing authority). **Part B** ruled 2026-07-04 (user
sign-off on B1–B4; B5 taken as recommended). **Part C** is the mechanical purge list.
The register is now complete — the build-ordered plan can be written against it.

---

## Part A — Resolved

### A1. Purge the billing/metering model
Leftovers of a removed billing model. `Bill` node in the server mermaid (server.md:53,61,63),
`auth-service` "balances" (server.md:500), "usage logs" (server.md:5, self-hosting.md:5,257,
future.md:299, architecture/index.md:64), `cost` response field (overview/index.md:65,
self-hosting.md:293).
**Ruling:** remove all. sitely is self-hosted; no billing, no `usage_logs` table, no `cost`/
`balance`/`tokens`. Postgres tables are exactly `consumers`, `api_keys`, `cached_resources`,
`robots_txt_cache`. Multi-tenant metering is a `/future/` (hosted) concern.
**Authority:** CLAUDE.md (explicit), supersedes summary:75 which still listed `balance`.

### A2. `schemas` block is gone — schema lives on the resource
schemas.md prose repeatedly says `defineSite({ schemas })` (11, 264, 295, 342) while its own
example uses per-resource `schema:`.
**Ruling:** `.resource(name, { schema, ... })` only. The manifest still aggregates a
`schemas` dictionary for downstream tools, populated from resources (keying: see **B5**).
**Authority:** summary:12, CLAUDE.md.

### A3. `capabilities` is gone
`resolveCapabilities` (framework-build.md:119), `ManifestCapabilities` (framework-build.md:125).
**Ruling:** remove. No capability surface; trust = operator lockfile.
**Authority:** summary:16, CLAUDE.md.

### A4. `examples` (page field) is gone
Survives as `page-example-no-match` / `page-example-not-in-locale-set` validation kinds
(framework-build.md:263-264) and "example URL" language (schemas.md:46, publishing.md:137).
**Ruling:** remove. Fixtures' typed `params` derive the URL; live re-check uses the URLPattern.
**Authority:** summary:14.

### A5. Consumer freshness knob is `maxAge`, never `ttl`
`ttl`-as-consumer-knob leftovers: consuming-api.md:349 ("knobs: fresh, ttl, acceptStale"),
self-hosting.md:106 (`?ttl=`), using-client.md:102 (lists `ttl` in call options).
**Ruling:** consumer knob is `?maxAge=` / `maxAge`. `ttl` is author-only resource policy.
There is no consumer `ttl` param.
**Authority:** CLAUDE.md (explicit), supersedes followup-plan 3.2.b's interim `ttl`-as-max-age.

### A6. No `not_fresh_enough` status
**Ruling:** `acceptStale:false` + failed re-extract → `status:"error"`. Seven statuses total:
`success | stale | no_matching_site | blocked | forbidden_by_robots | rate_limited | error`.
**Authority:** CLAUDE.md, supersedes followup-plan 3.2.b/5.4.

### A7. Error fixtures are inline `errorCase:true`, not `<name>.error.html`
Straggler `.error.html` model in testing.md:137 and data-flow.md:37.
**Ruling:** inline `{ params, errorCase:true }`; stored at the same params-hash path, with no
`expected.json`. The `.error.html` filename convention is dead.
**Authority:** summary:14 ("`errorCase:true` replaces the `.error.html` filename convention").

### A8. Fixture identity = params hash (not author name)
Named-fixture model in testing.md (`fixtures/home`, `--update fixtures/<name>`),
publishing.md:224 (`--name`), snapshot.ts (`SnapshotUrlOptions.name` + locale dir).
**Ruling:** `fixtures/<page-key>/<hash>.html` where `hash = sha256(canonicalize(params))[:12]`.
No human-chosen fixture names. `--update` / `--diff` take the params (or the hash).
**Authority:** glossary/sites/test-pkg + the fixture-hashing impl note (test-pkg.md:265).

### A9. `sitely snapshot` — params-primary, URL-convenience
URL-arg form (glossary:693, data-flow.md:17, snapshot.ts) vs params+`--page` (CLI, sites,
writing-a-site).
**Ruling:** primary form `sitely snapshot --page <key> '<params-json>'`. Also accept
`sitely snapshot <url>`, which reverse-parses to `(page, params)` via the registered patterns
(unambiguous — patterns are matched). Both write the same `<page-key>/<hash>` path.
Snapshot output path is `fixtures/<page-key>/<hash>.html` (kills snapshot.ts's
`fixtures/<locale>/<name>.html`; locale is a param, so it's in the hash, not a dir level).

### A10. Human review = three items
"Four-item"/"four checkpoints" (overview:16, publishing:50, future:77) vs the three actually
listed everywhere (testing.md, publishing:85, overview:28). The phantom fourth was
"capability vs observed behaviour" — died with capabilities.
**Ruling:** three — selector fragility, identity bucket, README sanity.

### A11. Live re-check = `sitely check --live`
`sitely test --live` (testing.md:242) vs `sitely check --live` (CLI table, writing-a-site,
schemas).
**Ruling:** `sitely check --live` is canonical (static + live extraction). Drop
`sitely test --live`.

### A12. Canonical key = `normalizeUrl(url) + locale`
Cache key "includes locale", coalesce key "normalised URL", batch dedup "URL + locale".
**Ruling:** one key — `(normalizeUrl(url), locale)` — for cache, coalescing, and batch dedup.
**Authority:** summary:57.

### A13. Descendant queries are `$` / `$$`, not `.find()`
Examples call `row.find(...)` (sites.md:94-96, writing-a-site:528) but `PageElement`
(page.md:100-114) exposes `$`/`$$`.
**Ruling:** `PageElement.$(sel)` / `.$$(sel)` for descendant queries. Remove `.find()` from
examples and the `ctx` reference table.

### A14. Package discovery = `node_modules` scan; `sites/*` glob is dev-only
`../../sites/*` glob (server.md:213) vs `node_modules` scan for a `sitely.manifest` pointer
(self-hosting.md:129).
**Ruling:** production discovery scans `node_modules` for packages whose `package.json`
declares the site-package shape (`sitely.manifest` pointer + readable `dist/manifest.json`).
The `sites/*` glob is a monorepo-dev convenience; frame it as such, not the contract.

### A15. Per-page `rateLimit` override — kept and specced
Documented in prose (writing-a-site.md:243) but absent from the `PageDef` type and that page's
own field table.
**Ruling:** keep it (followup-plan 5.2 resolved to "document it"). Add optional `rateLimit` to
the `PageDef` type and the reference table; it merges over the site-level config (only
overridden fields change).
**Authority:** summary:47, followup-plan 1.2/5.2→A.

### A16. One version, two surfaces
`Manifest` type has top-level `packageVersion`; `ManifestSite` has no version; prose references
`site.version`.
**Ruling:** a single version from `package.json`. The **manifest** field is top-level
`packageVersion`. The compiled **SiteDefinition** carries `site.version` (equal). The `409`
check compares the SiteDefinition's `site.version`. Fix manifest.md prose to name the manifest
field `packageVersion`; `ManifestSite` correctly has no version. *(Confirm — see B-note.)*

### A17. `extractedAt` is always present; no-data statuses = decision time
Duplicate `extractedAt` key is a literal typo in consuming-api.md:82-83 (second → delete).
**Ruling:** `extractedAt` on every response. For `no_matching_site`/`forbidden_by_robots`/
`rate_limited` (no extraction ran) it's the moment the decision was made. Keep always-present
per followup-plan 3.2.a. *(Naming caveat noted: it reads as "when data was produced" but for
no-data cases it's "as-of"; acceptable, documented.)*

### A18. Add `GET /v1/auth/keys`
The client exposes `auth.keys.list()` (using-client.md:789) with no backing route.
**Ruling:** add `GET /v1/auth/keys` returning key metadata (id, label, createdAt, lastUsedAt,
removedAt — never plaintext).

### A19. `crawl` / `CrawlConfig` — cut from v1
Referenced in the header type + reference tables, never defined; only appears via a robots
opt-out mention.
**Ruling:** remove `crawl` from the v1 `defineSite` header; note crawling under `/future/`
if pursued. *(Decide-with-veto — say if crawl config is actually in v1 scope.)*

### A20. `error-path-coverage` — conditional check + coverage warning
Mandatory ≥1 error fixture (sites.md:278, writing-a-site:631) vs conditional-if-present
(glossary:828, test-pkg.md:201).
**Ruling:** the must-pass check is **conditional** — any `errorCase:true` fixture must make
`validate` return `false`. "Page has no error fixture at all" becomes a **warning-only**
coverage check (like `fixture-coverage`), not a hard gate — forcing a synthetic error page is
noise for pages that have no error variant.

---

## Part B — Ruled (2026-07-04)

These were never decided in any planning note; each blocked an affected component spec.
B1–B4 carry the user's sign-off; B5 is taken as recommended (veto welcome).

### B1. `no_matching_site` HTTP status — 200 or 404?
Sequence diagrams say **200** (data-flow.md:122,131; server.md:135); the glossary status table
and consuming-api.md:493 say **404**.
- **200** keeps the envelope uniform: "always switch on `body.status`"; the client already
  treats `no_matching_site` as a result-object outcome (not a thrown error). But then a `404`
  never occurs and the routing miss looks like a normal result.
- **404** is HTTP-correct (no resource for this host) and matches the two text sources, but
  forces the client to handle both "HTTP 404" and "200 + body status" for no-data cases.
**Ruled:** **200 + `body.status:"no_matching_site"`** — the client models it as a branchable
result, not a thrown `SitelyError`. Fix the glossary/consuming-api 404 claims to say 200.

### B2. Rate limiter when Redis is down — fail closed or open?
Direct contradiction: server.md:497 (per-site acquire) **fails closed** → `rate_limited`;
self-hosting.md:311 says limits **fail open**.
**Ruled:** **split** — per-**site** outbound acquire fails **closed** (protect target sites
from unlimited hammering when the limiter is blind; matches the "politeness" bias), while
per-**key** inbound fails **open** (it only protects the server; blocking all inbound on a
Redis blip is worse than letting some through). State this once in the rate-limiter spec, and
fix self-hosting.md:311 (currently claims both fail open).

### B3. Derived-resource `extract` — field-functions or whole-object return?
The example returns raw `await r.json()` (framework.md:54, writing-a-site:187), which violates
"field-functions everywhere" and uses `ctx.params` on a resource that has no URL pattern.
- **Field-functions** (consistency): wrap each field `() => …`. Preserves per-field isolation
  + telemetry, but is awkward over a single JSON fetch.
- **Whole-object return** (ergonomic): derived `extract:(ctx, parent) => TOut | Promise<TOut>`
  returns a value validated against the resource schema as a whole; no per-field isolation.
**Ruled:** **whole-object return** — "field-functions everywhere" is a *page-extract* rule; a
derived resource has no DOM/selector-per-field story, so the isolation rationale doesn't apply.
Derived signature: `extract:(ctx, parent) => TOut | Promise<TOut>`, schema-validated as a whole.
A derived resource's `ctx.params` = the **parent resource's** URL-pattern params (it piggybacks
the parent fetch). This is a documented, principled exception to the field-function rule.

### B4. Admin surface in v1 — cut or enumerate?
`ADMIN_SECRET` / `X-Admin-Secret` are specced (glossary, server config, self-hosting) but no
`/v1/admin/*` route is ever listed, and the `auth_tier_overrides` table they'd manage
(self-hosting.md:160,205,253) isn't in the schema. With billing/tiering dropped (A1), the
admin surface may be dead too.
- **Cut:** remove `ADMIN_SECRET`, `/v1/admin/*`, `auth_tier_overrides`, per-consumer tiers;
  move tiering to `/future/`. Smallest v1.
- **Enumerate:** keep a minimal admin surface and actually spec the routes + table.
**Ruled:** **cut for v1** — matches "no metering/tiering; that's the hosted future." Remove
`ADMIN_SECRET`, `X-Admin-Secret`, `/v1/admin/*`, `auth_tier_overrides`, per-consumer tiers.
Per-key rate limits come only from `RATE_LIMIT_PER_KEY_PER_MINUTE`. Tiering → `/future/`.
Sweep: glossary "Admin secret" entry, server.md config, self-hosting.md:74,160,205,253.

### B5. Schema sidecar / manifest-schema key with inline schemas
Sidecars are `dist/schemas/<Name>.json` and the manifest keys `schemas` by name with resources
referencing `schemaRef` — but schemas are now **inline anonymous** objects on resources, so
`<Name>` has no source.
- **By resource name:** sidecar = `dist/schemas/<resourceName>.json`; manifest `schemas` keyed
  by resource name; drop the `schemaRef` indirection (resource → its own schema). Simple, but a
  schema shared by two resources emits twice.
- **Author-named:** require a name/brand on each schema (e.g. `.describe("Article")` or a
  `named()` wrapper); keep `schemaRef` dedup. More surface for authors.
**Ruled (my call — veto welcome):** **by resource name** for v1 (dedup is rare and cheap).
Sidecar = `dist/schemas/<resourceName>.json`; manifest `schemas` keyed by resource name; drop
the `schemaRef` indirection (resource → its own schema); record `schemaOrgType` per entry.
Revisit shared schemas if it bites.

---

## Part C — Mechanical purge checklist (from Part A)

Grep targets to zero out during the rewrite:
- `cost` (response field), `balance`, `tokens`, `usage_logs`, `usage log`, `Bill` (mermaid node)
- `definition_type` / `definitionType` (self-hosting.md:236 metric label)
- `ctx.media`, `ctx.page`, `Page`-as-driver-contract (future.md:190,228 → PageDriver/ctx.$)
- `resolveCapabilities`, `ManifestCapabilities`, `capabilit`
- `defineSite({ schemas })`, top-level `schemas` block references
- `page-example`, "example URL"
- consumer `?ttl=` / `ttl` call option (→ `maxAge`)
- `not_fresh_enough`
- `.error.html`
- `.find(` on page elements
- "fallback path" / "generic-extraction" / JSON-LD-fallback survivors (consuming-api.md:642,655)
- "four-item"/"four checkpoints" review (→ three)
