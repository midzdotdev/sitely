# Redesign follow-up plan

Follow-up audit of `planning/api-redesign-summary.md` against the docs as they stand after the 9-phase execution, plus three new user requests landed in this turn. Goal: produce a focused, file-by-file plan for the next edit pass.

Audit done against the docs at HEAD on 2026-05-28.

---

## Part 1 — Items from `api-redesign-summary.md` not fully landed

### 1.1 `sitely dev` tutorial — only in the CLI table

The summary says: *"`sitely dev` gets a real tutorial in the authoring guide."*

State now: a one-line entry in `docs/architecture/framework.md:478` ("Watch mode: re-runs `validate`+`extract` against fixtures as the author edits, with diffs"). No tutorial in `docs/guide/writing-a-site.md`. The CLAUDE.md style note also says "sitely dev tutorial wasn't added explicitly to writing-a-site.md" — confirmed.

**Fix:** add a "Live authoring with `sitely dev`" subsection to `docs/guide/writing-a-site.md` (between the "Capturing fixtures" and "Common edge cases" sections). Cover:

- The watch loop: edit source → re-run validate/extract against every fixture → print diff for any field whose output changed.
- Flag walk-through: `--only <page>`, `--fixture <hash>`, `--no-clear`.
- What it doesn't do: doesn't talk to a server, doesn't fetch live, doesn't run the 8 checks (use `sitely test` for that).
- Stop signal: Ctrl-C; the process is the supervisor for itself, not a daemon.

### 1.2 Per-page rate-limit override not documented

The summary says: *"Site-level declaration … Per-page override possible but discouraged."*

State now: no doc mentions per-page `rateLimit` overrides anywhere. Authors only see the site-level `rateLimit` block.

**Fix:** add one paragraph to `docs/guide/writing-a-site.md` (under the page-builder section) and one note to `docs/architecture/framework.md`'s `.page()` reference:

> A page can override the site-level rate limit by passing `rateLimit` as a third argument to `.page(...)`. Use this only when one page on the site is materially heavier or lighter than the rest — e.g. a search endpoint the operator caps tighter, or a static asset page the operator allows looser. The override is merged into the site-level config; only the overridden fields change.

If we don't actually want the override (the summary says "discouraged"), the alternative is a glossary note explaining why it's deliberately *not* offered. Pick one — see Part 5 for an open question.

### 1.3 Open items from the summary's "Still open" section

The summary lists three loose ends. None of them are documented yet.

**1.3.a Breaking-change baseline source.** Summary says: `dist/baseline-manifest.json` is default; `npm view` is the alternative; configurable via flag.

State: `docs/architecture/framework-build.md:27` documents that `--publish` rotates `baseline-manifest.json`. The `npm view` alternative and the flag are not mentioned. `docs/guide/publishing.md:214` documents the diff against `dist/baseline-manifest.json` but doesn't mention alternatives.

**Fix:**
- `docs/architecture/framework-build.md`: add a "Baseline source" subsection under the `semver-discipline` discussion. Document the default (committed baseline) and the `--baseline npm` alternative that fetches from the registry.
- `docs/guide/publishing.md`: brief mention with link to the architecture doc.
- `docs/guide/testing.md`: under `semver-discipline`, add a single sentence: "By default the check diffs against the committed `dist/baseline-manifest.json`; pass `--baseline npm` to diff against the latest published version on npm."

**1.3.b Strict vs lenient on missing minor bump.** Summary says: default to fail; let authors opt out.

State: not documented.

**Fix:** add to `docs/guide/testing.md`'s `semver-discipline` section:

> Both directions are strict by default: a breaking change without a major bump fails the check; additive changes without at least a minor bump also fail. Pass `--allow-missing-minor-bump` to demote the latter to a warning if you're intentionally batching additions into the next major.

**1.3.c `?resources=` syntax in client.** Summary lists two candidates:
- `sitely.site(d).resource("article", params, { include: ["comments"] })`
- `sitely.site(d).resources(["article", "comments"], params)`

State: neither appears in `docs/guide/using-the-client.md`. The HTTP API doc (`docs/guide/consuming-the-api.md:509`) documents `?resources=` but the client doesn't expose it.

**Fix:** decide and document one (see Part 5 — needs user input). Add it to:
- `docs/guide/using-the-client.md`'s "Calling sitely — three ways" section.
- The `CallOptions` interface at the bottom of `using-the-client.md`.

### 1.4 Site-version `409` handling on resource-filtered batched requests

Summary covers `409` in a single batch slot. State (`docs/guide/consuming-the-api.md:521`) documents this clearly. ✓ No gap.

### 1.5 `?resources=` cache invariance

Summary: *"Resource filter is response-time projection only; doesn't affect extraction or cache."*

State (`docs/guide/consuming-the-api.md:509`): "Server still extracts everything (cache stays uniform); filter is applied to the response shape." ✓ No gap.

### 1.6 `semver-discipline` check coverage

State: documented in testing.md, publishing.md, framework-build.md, sites.md. ✓ No gap.

### 1.7 `fixture-coverage` warning

Summary: *"Every optional/nullable field needs at least one fixture present and one absent."*

State (`docs/architecture/schemas.md:71`): documented as a warning. ✓ No gap.

### 1.8 Auto-batching transparency

Summary: *"Auto-batching transparent over one tick (one microtask coalesces). `createClient({ batch: false })` to disable."*

State (`docs/guide/using-the-client.md`): the `batch: false` option is not in the `ClientOptions` interface. The transparent batching is mentioned obliquely under `POST /v1/extract` in consuming-the-api.md but not in using-the-client.md.

**Fix:** add to `using-the-client.md`:
- `batch?: boolean` (default `true`) in `ClientOptions`.
- A "Batching" subsection under "Configuration" explaining the microtask coalescing and when to disable it (debugging, testing, profiling per-call latency).

### 1.9 GraphQL future-direction note

State (`docs/future/index.md:83-107`): present. ✓ No gap.

### 1.10 Browser extension future-direction note

State (`docs/future/index.md:109-126`): present. ✓ No gap.

### 1.11 Rate-limit discovery tool future-direction note

State (`docs/future/index.md:128-146`): present. ✓ No gap.

---

## Part 2 — Items from conversation possibly missed

Scanned through the conversation summary for decisions that didn't make it into either `api-redesign-summary.md` or the docs.

### 2.1 `ctx.lazy` error memoisation

Conversation point: `ctx.lazy(fn)` captures and re-throws errors so downstream fields see the same error; telemetry attributes the upstream cause to one root field.

State (`docs/architecture/framework.md` + `docs/guide/writing-a-site.md`): `ctx.lazy` is shown in examples but the error-memoisation property and the telemetry attribution rule are not explained.

**Fix:** add to `docs/architecture/framework.md` (under `ExtractContext`):

> `ctx.lazy(producer)` returns a memoised producer. The first call runs `producer()`; subsequent calls return the same value. If `producer()` throws, the error is captured and re-thrown on every subsequent call. The telemetry attributes the failure to the *root* `ctx.lazy` cell, not to every downstream field that called it — this stops a single broken sub-extractor from polluting per-field error rates across the page.

Mirror this in writing-a-site.md with a one-liner.

### 2.2 Token bucket / circuit breaker Redis key shapes

Conversation point: implementation notes (token bucket Redis Lua script, circuit-breaker state per hostname) live in an "Implementation notes" section.

State (`docs/architecture/server.md`): the implementation-notes section exists at the bottom of server.md. ✓ No gap.

### 2.3 Server-wide cap interaction with per-site limits

Conversation point: `SERVER_MAX_INFLIGHT_EXTRACTIONS` is independent of per-site limits; the more-restrictive of the two wins.

State (`docs/guide/self-hosting.md`): the env var is documented. Need to confirm the "more-restrictive wins" semantic is explicit.

**Fix:** add a single sentence to the env-var description: "When both this cap and a per-site `maxConcurrent` apply, the more restrictive of the two governs."

### 2.4 Browser-side API key safety

Conversation point: discussed using a backend proxy to hold the long-lived key; browser-safe keys (tighter limits, short-lived) are out of scope today.

State (`docs/guide/using-the-client.md:666-668` and `docs/guide/consuming-the-api.md:549`): documented. ✓ No gap.

### 2.5 SSE / push delivery

Conversation point: not supported; polling is the pattern.

State (`docs/guide/using-the-client.md:638-641` and `docs/guide/consuming-the-api.md:601-603`): documented. ✓ No gap.

### 2.6 The "field functions everywhere" rule for constants

Conversation point: even constants must be functions (`type: () => "Article" as const`) — for per-field telemetry consistency.

State (`docs/guide/writing-a-site.md` and `docs/architecture/framework.md`): present in code examples. CLAUDE.md style note now records this rule. ✓ No gap.

### 2.7 `derivedFrom` strict ordering compile error

Conversation point: composing out of order is a compile error, not a runtime error.

State (`docs/architecture/framework.md`): present. Mentioned that the builder accumulates `TResources` for typing.

**Fix:** explicit example in writing-a-site.md showing the compile error when `derivedFrom: "article"` is declared before `.resource("article", ...)`.

### 2.8 Segment `requires` type constraint

Conversation point: each segment carries a `requires` type that must be satisfied by what's accumulated when `.use()`d.

State (`docs/architecture/framework.md`): present in the segment-composition section.

**Fix:** add an explicit failing case to writing-a-site.md — what the compile error looks like when a segment's `requires` isn't satisfied.

### 2.9 `checkResponse` only runs on parseable responses

Conversation point: connection-level failures (timeout, DNS, TCP reset) bypass `checkResponse` — the framework auto-treats them as `TransientError` with backoff retry.

State (`docs/guide/writing-a-site.md:149`): documented. ✓ No gap.

### 2.10 Adaptive backoff (50% drop, 1-minute window, linear recovery)

State (`docs/architecture/server.md:579`): documented. ✓ No gap.

---

## Part 3 — Three new user requests (this turn)

### 3.1 "Design Preview" / RFC stage notice across the docs

**Request:** Make it clear that no implementation exists. Use a term like "Design Preview" or RFC/Proposal.

**Current state:** `README.md:5` mentions "architecture-design phase" but the docs site itself doesn't surface this anywhere. A consumer landing on `docs/index.md` reads tagline + features as if the system is shippable today.

**Plan:**

**3.1.a Pick a term.** Recommended: **"Design Preview"**. Rationale:
- "RFC" implies a single document open for comment; the docs are a whole specification.
- "Proposal" reads as tentative ("we're proposing this") — too soft for the stage we're at (the design is settled; implementation hasn't started).
- "Design Preview" matches the current state: the architecture is defined, you can read it end-to-end, no code runs yet.
- Verifying via user input below (Part 5).

**3.1.b Where to surface it.**

1. **VitePress site banner.** Add a `themeConfig` "outline notice" at the top of every page using a custom layout slot — a single line: "Design Preview — sitely has no implementation yet. The docs describe the system as it will exist." This is the durable approach; one source of truth, every page shows it.

2. **`docs/index.md` hero.** Replace the tagline with a tagline + status badge. Drop the "you can use this today" framing.

3. **`docs/overview/index.md`.** Add a "Status" subsection at the very top, before "Who this is for".

4. **`docs/architecture/index.md`.** Add a one-line status block at the top — readers entering through the architecture map should know what they're reading.

5. **`README.md`.** Keep the existing line, but match the wording the docs use ("Design Preview" everywhere).

6. **`docs/future/index.md`.** Already correctly framed; just rename internal references to be consistent.

7. **`CLAUDE.md`.** Add a style note: "Design Preview" is the canonical term for the current stage; do not say "shipped" / "today" / "production".

**3.1.c Wording to avoid.** Across all docs, sweep for phrasings that imply present-tense reality where it would mislead a reader who hadn't read the status badge:

- "sitely respects" → "sitely will respect" or just rephrase imperatively
- "we ship X" → "X is part of the package surface" (descriptive, not deliverable-claim)
- "production defaults" → "the built-in defaults" or "the operator-facing defaults"

This is **not** a full rewrite to future tense — the CLAUDE.md rule is "present tense as though sitely exists today." The status banner makes that framing safe. We only edit prose where the banner-plus-page combination still misleads (e.g. "Production defaults" in a feature card).

### 3.2 Response freshness via timestamp + client `maxAge` semantics

**Request:** Response should expose timestamp of when extracted. Client should be configurable to fail when the passed `ttl` is not satisfied.

**Current state:**
- `ExtractResult` envelope has `cached: boolean` and `status: "success" | "stale" | …` — no `extractedAt` timestamp.
- `?ttl=15m` query param **overrides the cache TTL** (it tells the cache how long to keep the new value). It is not a "max age" / freshness constraint from the consumer's perspective.
- `fresh: true` bypasses the cache entirely. Binary on/off.
- `stale` status returns cached data with `cached: true` after extraction failure. The consumer can't opt out of that fallback.

There are two related but distinct gaps. Address both.

**3.2.a Add `extractedAt` to every response.**

Add to `ExtractResult`:

```ts
{
  status: "success" | "blocked" | "stale" | "forbidden_by_robots" | "rate_limited" | "error",
  data: T | null,
  cached: boolean,
  extractedAt: string,           // ISO-8601 — when this *data* was produced (always present)
  cachedAt?: string,             // ISO-8601 — when the cache row was written (present iff cached)
  ...
}
```

- `extractedAt` is the wall-clock time at which the underlying extraction ran. Same value across cached and fresh responses for the same row.
- `cachedAt` is the time the cache wrote the row; `extractedAt === cachedAt` for the row that produced the cache entry. Present only when `cached: true`.
- For `forbidden_by_robots` / `rate_limited` (no data produced), `extractedAt` is the time the decision was made.

Files to update:
- `docs/guide/consuming-the-api.md` — the response shape, "TTL and freshness" section, all example responses.
- `docs/guide/using-the-client.md` — the `ExtractResult<T>` interface, status-discrimination example.
- `docs/overview/glossary.md` — add a "Freshness fields" entry (or extend the existing Cache entry).
- `docs/architecture/server.md` — note that the cache row carries `extractedAt`; cache writes set both columns.
- `docs/architecture/manifest.md` — no change (manifest doesn't carry this).

**3.2.b Redefine `ttl` query param: from "cache write TTL" to "consumer max-age constraint".**

Current semantic: `?ttl=15m` writes the cache with 15-minute TTL.
Proposed semantic: `?ttl=15m` means **"I need data ≤ 15 minutes old."**

Behaviour with the new meaning:
- If the cached row's `extractedAt` is within the requested age → serve cached.
- If older → re-extract; on success, return the fresh value.
- If older AND re-extract fails → **return `not_fresh_enough` (new status) rather than `stale`** unless the caller also passed `acceptStale: true`.

The old semantic (consumer chooses cache TTL) was strange — most consumers don't want to set the cache TTL, they want freshness guarantees. The cache TTL is the resource author's concern, declared on the resource. The consumer's concern is "is this data fresh enough for my use case?". The new semantic aligns the field name with how consumers actually think.

**New status value: `not_fresh_enough`.**

- HTTP `200`, status `not_fresh_enough`.
- `data: null` (we have stale data but didn't return it because the consumer asked for fresher).
- `extractedAt` of the cached row is included so the consumer can decide whether to fall back manually.
- Token cost: 0 if cache-only check; same as a normal extraction if a refetch was attempted and failed.

**Client option: `acceptStale: boolean` (default `true`).**

- Default `true`: behaviour matches today's "any data is better than no data" stance — `stale` is returned when re-extract fails.
- `false`: re-extract failure with a `ttl` constraint returns `not_fresh_enough`.

Add to:
- `docs/guide/consuming-the-api.md` — TTL section, status table, response envelope.
- `docs/guide/using-the-client.md` — `CallOptions` interface (`ttl`, `acceptStale`), status discrimination.
- `docs/overview/glossary.md` — TTL entry, freshness entry.
- `docs/architecture/server.md` — extract-orchestrator decision tree (cache-hit-young vs cache-hit-aged vs miss).

**Breaking-vs-additive note:** changing `ttl` semantics is a wire-contract change but in this case it's coherent — the system has no implementation, and the docs are the contract. The old semantic appears only in the docs as written; no client depends on it. Document the new semantic everywhere the old one appeared.

**3.2.c What about `fresh: true`?**

Keep it. `fresh: true` is "bypass cache regardless of age" — useful when the consumer knows the underlying data has changed (e.g. a webhook fired). `ttl: "Xm"` is "data must be ≤ X old". Different intent:
- `fresh: true` → force a refetch even if the cache is young.
- `ttl: "5m"` → fine to serve from cache if young enough; refetch only if too old.

Both are valid; they compose. Passing both is equivalent to `fresh: true` (force-refetch overrides freshness comparison).

### 3.3 Replace "schema.org-shaped" wording

**Request:** The phrasing "schema.org-shaped response types" implies resources are limited to schema.org. They aren't — resources can extend or replace schema.org freely.

**Current state:** the phrase appears in:
- `docs/index.md:7` (hero tagline): "Schema.org-shaped data from sites sitely knows"
- `docs/guide/using-the-client.md:3`: "schema.org-shaped response types"
- `docs/architecture/schemas.md:3`: "ships a catalogue of schema.org-shaped validators"
- `docs/architecture/schemas.md:105`: "schema.org-shaped"
- `docs/architecture/schemas.md:118` (mermaid diagram label): "schema.org-shaped catalogue"
- `docs/architecture/schemas.md:195`: "validators shaped to schema.org's vocabulary"

The glossary already handles this correctly — `Resource` and `Schema` both call out the schema.org subset vs extension distinction explicitly. The audit is mostly cosmetic.

**Plan:**

For each occurrence, distinguish two cases:

**Case A — describing `@sitely/schemas`'s shipped catalogue.** The catalogue *is* schema.org-derived; "schema.org-shaped" is technically accurate but reads as "consumer-facing schemas are limited to schema.org." Rephrase:
- "schema.org-derived validators" — emphasis on provenance, not boundary.
- "the schema.org catalogue" — flatter, just a noun.
- "validators for common schema.org types" — descriptive, doesn't claim boundary.

**Case B — describing what consumers get back.** The phrasing here is the misleading one. Replace:
- "Schema.org-shaped data" → "Typed JSON" or "Schema-typed JSON" or just "Typed responses"
- "schema.org-shaped response types" → "fully-typed response shapes" or "typed response data"

**File-by-file edits:**

1. `docs/index.md:7` (hero tagline):
   - Before: "One call. Schema.org-shaped data from sites sitely knows, a JSON-LD fallback for everything else. Pass installed site packages to the client and the types flow end to end."
   - After: "One call. Typed JSON from sites sitely knows, a JSON-LD fallback for everything else. Pass installed site packages to the client and the types flow end to end."

2. `docs/guide/using-the-client.md:3`:
   - Before: "It wraps the HTTP API with typed methods, schema.org-shaped response types, automatic pagination, retries, and cancellation."
   - After: "It wraps the HTTP API with typed methods, inferred response shapes, automatic pagination, retries, and cancellation."

3. `docs/architecture/schemas.md:3`:
   - Before: "ships a catalogue of schema.org-shaped validators (Article, Product, ItemList, …)"
   - After: "ships a generated catalogue of schema.org validators (Article, Product, ItemList, …) that site authors compose into their own Resource schemas"

4. `docs/architecture/schemas.md:105` (the Schema.org section):
   - Before: "The catalogue's validators are *schema.org-shaped* so that downstream consumers …"
   - After: "The catalogue's validators are *generated from schema.org* so that downstream consumers can reason about extractions in a single shared vocabulary."

5. `docs/architecture/schemas.md:118` (mermaid label):
   - Before: `Catalog["schema.org-shaped<br/>catalogue<br/>(Article, Product, …)"]`
   - After: `Catalog["schema.org catalogue<br/>(Article, Product, …)<br/>generated"]`

6. `docs/architecture/schemas.md:195`:
   - Before: "the generated catalogue of validators shaped to schema.org's vocabulary"
   - After: "the generated catalogue of validators for schema.org's published vocabulary"

Each of these reads less like "your responses are limited to schema.org" and more like "schema.org is a vocabulary the catalogue covers, not a ceiling on what you can return."

Cross-link, where useful, the existing glossary entry on `Resource` that already calls this out — but the glossary itself doesn't use "schema.org-shaped" so it's safe.

---

## Part 4 — Anchor / cross-link audit (carry-over from the CLAUDE.md note)

The CLAUDE.md style note warns: "when adding a new glossary entry, also cross-link first uses in every guide page that mentions the term."

Two glossary entries added in the redesign that don't have full cross-linking:

### 4.1 `Framework errors`

Glossary entry exists. First-use cross-links should appear in:
- `docs/guide/writing-a-site.md` — used in the `checkResponse` walkthrough (`/overview/glossary#framework-errors`). ✓ confirmed at line 133.
- `docs/architecture/framework.md` — used in the `.checkResponse()` reference. ✓ confirmed at line 146.
- `docs/guide/consuming-the-api.md` — no current use, but the four `ResponseError` subtypes underpin the `status: "blocked"` / `"rate_limited"` outcomes. Consider a one-line cross-link.

### 4.2 `Presence annotation`

Glossary entry exists. First-use cross-links should appear in:
- `docs/architecture/schemas.md` — present. ✓
- `docs/guide/writing-a-site.md` — present.
- `docs/guide/testing.md` — under the `fixture-coverage` warning, where presence and coverage interact. ✓
- `docs/architecture/manifest.md` — currently not linked; the `x-sitely-presence` annotation is mentioned in schemas.md but not from manifest.md. Add a one-line note in the schema-summary table referencing the presence rate.

### 4.3 `checkResponse`

Glossary entry exists. First-use cross-links in:
- `docs/guide/writing-a-site.md` — ✓
- `docs/architecture/framework.md` — ✓
- `docs/architecture/server.md` — the extract orchestrator section mentions `checkResponse` indirectly. Add a one-line link.

---

## Part 5 — Open questions for the user

Three decisions in the plan need user input before edits land.

### 5.1 Status-stage term

Use **"Design Preview"** (recommended) — or:
- "RFC" — implies the design is open for comment; arguable.
- "Proposal" — softer, more tentative.
- Something else.

This is a one-time naming decision; once picked, it's the term in the banner, the README, the home page, the overview, and the CLAUDE.md style note.

### 5.2 Per-page `rateLimit` override

Two options:
- **A. Document it.** Add the override mechanic to writing-a-site.md and framework.md. Plays back what the summary said.
- **B. Drop it.** The summary said "discouraged"; we may just want to omit the surface and keep `rateLimit` site-level only. Less surface, less to explain.

If we drop it, we should add a glossary or rate-limit-section note explaining why per-page overrides aren't offered (forces authors to think about the site as a whole; if one page needs different limits, that's a sign the page belongs to a different package).

### 5.3 `?resources=` client syntax

Two candidates from the summary:
- **A. `sitely.site(d).resource("article", params, { include: ["comments"] })`** — `include` lives in the call options on the primary resource call. Reads as "give me article *and also* comments."
- **B. `sitely.site(d).resources(["article", "comments"], params)`** — distinct method name; multi-resource is first-class.

Recommended: **A**, on the grounds that it leaves the single-resource type inference intact (the primary `resource` call still narrows to the named resource; `include` is an additive widening). With **B**, the result type becomes a multi-key object every time, which is heavier when the caller wants one resource and a sidecar.

### 5.4 New status `not_fresh_enough` and the `acceptStale` flag

Confirm:
- The new status string is `not_fresh_enough` (alternatives: `stale_rejected`, `too_old`).
- `acceptStale: true` is the default (matches today's "data over no data" lean).
- `ttl` query param's meaning changes from "cache TTL override" to "max age". The old meaning is dropped, not aliased.

Or — if the user prefers — keep the existing `ttl` meaning and add a new `maxAge` option to avoid the breaking-semantic change. Naming is cosmetic; the question is one knob with new meaning, or two knobs that mean two things.

### 5.5 Quick-start `page.data` shape (from 5b.1) — DECIDED

**Decision:** call-style-driven unwrap. `client.extract({ url })` returns the wire shape (keyed); `client.site(d).resource(name)` returns the named resource's data directly; `client.site(d).resource(name, params, { include })` returns the keyed multi-resource shape. Reverses audit A.2.

### 5.6 Retry-topology numbers (from 5b.2) — DECIDED

**Decision:** first-draft defaults.
- Server-side (Hop 2, sitely ↔ target): 3 TransientError retries; 250ms → 1s → 4s; ±25% jitter; ~5.5s worst-case added latency.
- Server-side (Hop 2): 5s rate-limiter queue bound on RateLimitedError before surfacing `rate_limited`.
- Client-side (Hop 1, consumer ↔ sitely): keeps existing `retry` config (3 attempts, exponential, 250ms → 5s).

---

## Part 5b — Additional follow-up points (added this turn)

### 5b.1 Quick-start `page.data` shape is misleading

**Decided rule (user's resolution to 5.5):** the unwrap is **call-site-driven**, not response-shape-driven.

- **`client.extract({ url })`** — URL-driven. Returns the wire shape *as received*. `result.data` is the keyed object: `{ article: {...} }` or `{ category: {...}, itemList: [...] }`. The caller didn't name a resource, so the client can't pick one to unwrap to.
- **`client.site(d).resource(name, params)`** — resource-driven, single resource. Returns *just that resource's data*. `result.data` is the Article shape directly. Mental model: "I asked for an article; I got an article."
- **`client.site(d).resource(name, params, { include: [...] })`** — resource-driven, multi-resource. Returns the keyed object with the primary + included resources. `result.data.article`, `result.data.comments`.

This supersedes audit A.2's "unwrap iff single-resource" rule. The new rule is cleaner: unwrapping is a function of the call style, not the response shape. A page that today provides one resource and tomorrow provides two doesn't change `extract({ url })`'s shape — both forms remain keyed. The resource-driven call's return type is the schema-output type when there's no `include`, and the keyed union when there is.

**Type implications:**

```ts
// URL-driven — keyed
const page = await sitely.extract({ url });
// page.data: { article: Article } | { category: Category, itemList: ItemList[] } | ... | null
// (the union spans every page registered for the matching hostname; narrow with status)

// Resource-driven, single resource — unwrapped
const a = await sitely.site("en.wikipedia.org").resource("article", { title: "x" });
// a.data: Article | null

// Resource-driven, multi resource — keyed (include widens the type)
const both = await sitely.site("en.wikipedia.org")
    .resource("article", { title: "x" }, { include: ["comments"] });
// both.data: { article: Article, comments: Comment[] } | null
```

**Files affected:**
- `docs/index.md` — quick-start uses `site(d).resource(...)`; current example is correct under the new rule. Verify and leave.
- `docs/overview/index.md` — same; the resource-driven example stays. The "By URL" subsection (`sitely.extract`) needs the keyed shape — currently shows `page.data` as if unkeyed.
- `docs/guide/using-the-client.md:131-153` — the `ExtractResult<T>`/"data unwrapping" section needs a full rewrite. The current rule "single-resource case unwrapped" is replaced. Add a small example for each of the three call shapes.
- `docs/guide/consuming-the-api.md:174` — the wire-shape paragraph already correctly describes `data` as keyed. Update the cross-link sentence ("the client unwraps the single-resource case for ergonomics") to reflect the new rule.
- `docs/overview/glossary.md` — the Resource entry mentions wire shape; verify the language doesn't reference the old unwrap rule.
- `CLAUDE.md` — add a style note: "The client unwraps `data` *iff* the call is resource-driven with no `include`. URL-driven calls and multi-resource resource calls return the keyed wire shape verbatim. Don't reintroduce 'unwrap if single-resource'."

### 5b.2 Retry topology — server-side vs client-side

**Issue:** the docs don't clearly delineate where retries happen. Pieces are spread across:

- `docs/guide/using-the-client.md:82-92` — client retries 5xx + network errors with exponential backoff.
- `docs/guide/writing-a-site.md:149` — "framework treats [connection-level failures] as TransientError automatically with backoff retry" (implies *server-side* retry).
- `docs/architecture/server.md:579` — adaptive backoff: 50% bucket rate drop on 429.
- `docs/architecture/framework.md:291` — `TransientError` has a `retryAfter` option but the retry behaviour isn't specified.

Nothing says, in one place: "the server retries N times on TransientError inside one extract call; the client retries M times on transport failure between client and server."

**Plan:** add a single "Retry topology" subsection — one canonical place describing what retries where. Two-layer model:

**Layer 1 — server-side (inside `extract-service`, between sitely and the target site):**

- **TransientError** (DNS, TCP reset, timeout, 5xx from target) → retry up to **3 times** with exponential backoff (250ms → 1s → 4s), with ±25% jitter. After exhausting, surface as `status: "error"` (with a `stale` fallback if a cached row exists and `acceptStale` is true).
- **RateLimitedError** (target returns 429 or matches `checkResponse` 429 rule) → adaptive backoff kicks in (50% bucket drop, 1-minute window). The current request waits in the rate-limiter queue up to a small bound (e.g. 5s); if it can't be served, returns `status: "rate_limited"` immediately.
- **BlockedError / CaptchaError** → no retry. Counts toward the per-hostname circuit breaker. Returns `status: "blocked"`.
- **PermanentError / BadResponseError** → no retry. Returns `status: "error"` with the error reason in the response envelope.

**Layer 2 — client-side (between consumer and sitely server):**

- **Network errors** (DNS, TCP reset, timeout reaching the sitely server itself) → client retries per `retry` config.
- **5xx from the sitely server** → client retries.
- **429 from the sitely server** (your per-API-key rate limit was hit) → client retries after `Retry-After`.
- **4xx (except 429)** → no retry. Surfaces as a thrown `SitelyError` subclass.
- **`status: "stale"` / `"blocked"` / `"forbidden_by_robots"` / `"rate_limited"` (target-site outcomes)** → the client treats these as *successful* HTTP exchanges that returned a structured non-200 outcome in the body. **No client retry** — the result is the answer.

**Single retry path per outcome.** The server's layer-1 retries are invisible to the client; by the time the client sees a response, layer-1 is done. The client's layer-2 retries cover the client↔server hop only. There's no double-retry path.

**Where to write this:**
- New subsection in `docs/architecture/server.md` titled "Retry topology" — the canonical source.
- One-paragraph summary in `docs/guide/using-the-client.md` under the existing "Rate limits" section, cross-linked.
- One-paragraph summary in `docs/guide/writing-a-site.md` under `checkResponse` — what the framework does *after* you throw a `TransientError` / `RateLimitedError`.
- Glossary entry: **Retry topology** — points at the architecture doc.

This is documentation only; no contract change. The numbers above (3 retries, 250ms initial, 5s queue bound) are first-draft defaults — refine if the user has stronger opinions.

---

## Part 6 — Execution order (when approved)

Group by file to keep each file touched once.

### Phase A — User-decision items

1. Get answers for 5.1, 5.2, 5.3, 5.4 before any edits.

### Phase B — Status banner + wording sweep (request 3.1)

2. `docs/.vitepress/config.mts` — add the status banner slot/component.
3. `docs/index.md` — hero updates, status badge.
4. `docs/overview/index.md` — "Status" subsection at the top.
5. `docs/architecture/index.md` — one-line status block.
6. `README.md` — align wording.
7. `CLAUDE.md` — add the style-note entry.

### Phase C — Freshness contract (request 3.2)

8. `docs/guide/consuming-the-api.md` — `extractedAt` / `cachedAt`, new `ttl` semantics, `not_fresh_enough` status, status table, all examples.
9. `docs/guide/using-the-client.md` — `ExtractResult` shape, `CallOptions` (with `acceptStale`), status discrimination, freshness section.
10. `docs/overview/glossary.md` — freshness entry, TTL entry update, status entry.
11. `docs/architecture/server.md` — extract-orchestrator freshness decision tree, cache schema columns.

### Phase D — "schema.org-shaped" wording (request 3.3)

12. `docs/index.md` — hero tagline (already touched in Phase B; combine).
13. `docs/guide/using-the-client.md` — intro paragraph (already touched in Phase C; combine).
14. `docs/architecture/schemas.md` — three occurrences; intro, "Schema.org plays a related but different role" paragraph, mermaid label, modules section.

### Phase E — Missing summary items (Part 1)

15. `docs/guide/writing-a-site.md` — `sitely dev` tutorial (1.1), per-page `rateLimit` (1.2; depends on 5.2), `derivedFrom` compile-error example (2.7), segment `requires` error example (2.8).
16. `docs/guide/using-the-client.md` — `?resources=` client syntax (1.3.c; depends on 5.3), batching option (1.8).
17. `docs/architecture/framework.md` — `ctx.lazy` error memoisation (2.1).
18. `docs/architecture/framework-build.md` — baseline source subsection (1.3.a).
19. `docs/guide/testing.md` — baseline source one-liner (1.3.a), strict/lenient bump (1.3.b).
20. `docs/guide/publishing.md` — baseline source mention (1.3.a).
21. `docs/guide/self-hosting.md` — `SERVER_MAX_INFLIGHT_EXTRACTIONS` interaction (2.3).

### Phase F — Anchor / cross-link audit (Part 4)

22. `docs/guide/consuming-the-api.md` — `Framework errors` cross-link (4.1).
23. `docs/architecture/manifest.md` — presence-annotation cross-link (4.2).
24. `docs/architecture/server.md` — `checkResponse` cross-link (4.3).

### Phase H — Call-style-driven unwrap rule (5b.1 / 5.5)

25. `docs/index.md` — verify resource-driven quick-start works under new rule (it does); no change needed unless the example accidentally implies a different rule.
26. `docs/overview/index.md` — update the `sitely.extract({ url })` example to show the *keyed* shape (`page.data.article.headline` or equivalent); the resource-driven example stays unwrapped.
27. `docs/guide/using-the-client.md:131-153` — full rewrite of the "data unwrapping" paragraph: explain the call-style-driven rule with one example for each of the three call shapes.
28. `docs/guide/consuming-the-api.md:174` — update the cross-link sentence (currently "client unwraps the single-resource case for ergonomics") to reflect the new rule.
29. `docs/overview/glossary.md` — Resource entry: align wire-shape language with new rule.
30. `CLAUDE.md` — new style note: "Client unwraps `data` iff the call is resource-driven with no `include`. Don't reintroduce 'unwrap if single-resource'."

### Phase I — Retry topology (5b.2 / 5.6)

31. `docs/architecture/server.md` — new "Retry topology" subsection (canonical source). Cover Hop 1 vs Hop 2, the two-layer model, server-side defaults (3 retries, 250ms → 1s → 4s, ±25% jitter), and the no-double-retry guarantee.
32. `docs/guide/using-the-client.md` — one-paragraph summary under "Rate limits" with cross-link to server.md.
33. `docs/guide/writing-a-site.md` — one-paragraph summary under `checkResponse` (what the framework does after the author throws `TransientError` / `RateLimitedError`).
34. `docs/overview/glossary.md` — new "Retry topology" entry pointing at the architecture doc.

### Phase G — Verify

35. `pnpm docs:build`.
36. `grep -r "schema.org-shaped" docs/` — should return zero hits in source markdown.
37. `grep -r "tokens:" docs/` — should still return zero (catches token-balance regressions).
38. `grep -rn "page\.data\." docs/ | grep -v "data\.article\|data\.category\|data\.itemList"` — confirm URL-driven `extract({ url })` examples show the keyed shape; resource-driven examples can unwrap.
39. Skim the home page, overview, and architecture index for the Design Preview banner displaying correctly.

---

## What this plan does *not* propose

- No new top-level pages.
- No IA changes.
- No new banned-words rules beyond the Design Preview addition.
- No retreat from present-tense writing — the banner makes present-tense safe.
- No real-implementation changes (this is a docs-only pass).

## Critical files

- `docs/index.md`
- `docs/overview/index.md`
- `docs/overview/glossary.md`
- `docs/architecture/index.md`
- `docs/architecture/schemas.md`
- `docs/architecture/server.md`
- `docs/architecture/framework.md`
- `docs/architecture/framework-build.md`
- `docs/architecture/manifest.md`
- `docs/guide/consuming-the-api.md`
- `docs/guide/using-the-client.md`
- `docs/guide/writing-a-site.md`
- `docs/guide/testing.md`
- `docs/guide/publishing.md`
- `docs/guide/self-hosting.md`
- `docs/.vitepress/config.mts`
- `README.md`
- `CLAUDE.md`

No files outside `docs/`, `planning/`, `CLAUDE.md`, `README.md`. No new files (except possibly a VitePress layout-slot component for the status banner — TBD on inspection).
