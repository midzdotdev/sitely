# Implementation plan

> **Design Preview.** No code exists yet. This plan is **v0-first**: a proof-of-concept scoped
> to the one hypothesis that must hold before anything else — that authoring a scraper is
> ergonomic, declarative, and type-safe over a *backend-neutral* DOM — then a v1 outline for the
> rest. Full-system conflict rulings from the earlier design live in
> `planning/REBUILD-DECISIONS.md`; the scope decisions behind *this* plan are in
> [Locked decisions](#locked-decisions).

## North-star goals

The project's durable goals. v0 proves **G1** and **G5** and keeps seams open for the rest;
everything else is v1+.

- **G1 · Ergonomic, maximally-declarative authoring.** The author states *what* to extract; the
  framework owns the piping.
- **G2 · Cross-site interop by common interface.** A consumer asks for a *resource by interface* —
  "give me an `Article`" — and gets it from every site that implements it. Base interfaces are
  **generated** (from schema.org) and **annotated** so the runtime can route interface requests.
- **G3 · Type-safe consumption.** Consumers get types with no hand-maintained duplication —
  leaning **GraphQL** (interface types = common resources; introspection supplies types).
- **G4 · Reliability platform.** Tooling that keeps scrapers correct over time: fixture
  management, live-check cron, optional-field-selector drift alerts, a scraper compliance suite.
- **G5 · Performance & backend neutrality.** Static HTML by default (cheap); **one sync DOM
  interface** spanning static (Cheerio/JSDOM) and dynamic (Playwright/CDP, with interaction), so
  moving a scraper between backends changes *no extraction code*.

## v0 — the proof of concept

**The hypothesis:** ergonomic, declarative, type-safe authoring over a backend-neutral DOM that
serves static *and* dynamic (interaction-gated) sites — in-process, **no server, no consumer**.

**Definition of done:** you author the three example scrapers below and a `sitely dev` /
`sitely test` loop gives schema-validated, typed extraction from committed fixtures, with
authoring mistakes (a field function whose return doesn't match its resource's schema, a `p.many` binding that returns a single object)
caught at **compile time**. The proof is the *feel* of authoring plus the *correctness* of the
output — across a clean static site and a brutal dynamic one.

### The extraction lifecycle

The load-bearing architecture: async setup, **sync extraction** — identical across every backend.

```mermaid
flowchart LR
    L["launch(url)"] --> P{"prepare?"}
    P -- "dynamic" --> I["interact:<br/>click · scrollTo · waitForSelector"]
    P -- "static" --> M["materialize()<br/>settle + snapshot<br/>→ sync PageDriver"]
    I --> M
    M --> V["validate(ctx)<br/><b>sync</b>"]
    V --> E["extract(ctx)<br/><b>sync</b><br/>resolve field fns<br/>→ validate JSON Schema"]

    classDef async fill:#2a3a4a,stroke:#88c0d0,color:#eceff4
    classDef sync fill:#2a4a3a,stroke:#a3be8c,color:#eceff4
    class L,I,M async
    class V,E sync
```

- **`launch(url)`** — static: fetch. dynamic: open a browser page (Playwright/CDP), navigate.
- **`prepare(page)`** — *optional, per-page, async, dynamic-only.* The author drives
  interaction-gated content into the DOM with `click` / `scrollTo` / `scrollToBottom` /
  `waitForSelector`. Absent for static sites. Expand the accordion; scroll the job description
  into view.
- **`materialize()`** — settle, then snapshot the now-complete DOM into a sync `PageDriver`.
- **`validate(ctx)` / `extract(ctx)`** — **sync**, against the snapshot. `extract` returns
  field-function objects; the runner resolves them and validates the result against the
  resource's JSON Schema.

**Fixtures capture the post-`prepare` DOM**, so interaction-gated sites still test statically and
deterministically — the interaction runs at *capture* time, not test time.

### Components & build order

```mermaid
flowchart TB
    C["00 · contracts<br/>types only"]
    Pg["01 · @sitely/page<br/>drivers"]
    Rt["02 · @sitely/runtime<br/>the runner"]
    Fw["03–04 · @sitely/framework<br/>DSL · schema · test · CLI"]

    C --> Pg
    C --> Rt
    Pg --> Rt
    C --> Fw
    Pg --> Fw
    Rt --> Fw

    classDef leaf fill:#2a4a3a,stroke:#a3be8c,color:#eceff4
    classDef mid fill:#3a2a4a,stroke:#b48ead,color:#eceff4
    class C leaf
    class Pg,Rt,Fw mid
```

| # | Spec | Package | Scope |
|---|---|---|---|
| 00 | [Contracts](./00-contracts) | *(shared types)* | `SiteDefinition` (v0 subset), driver interfaces, runner result, the JSON-Schema boundary, error taxonomy. |
| 01 | @sitely/page | `@sitely/page` | Sync `PageDriver`/`PageElement` + Cheerio driver; Playwright/CDP driver + the `prepare` interaction API (opt-in so static-only users skip Chromium). JSDOM-ready, deferred. |
| 02 | @sitely/runtime | `@sitely/runtime` | The runner: `launch → prepare → materialize → validate → extract → resolve field fns → validate schema`. Driver-injected. **Reused verbatim by the v1 server.** |
| 03 | Framework — DSL | `@sitely/framework` | `resource`, `page` (with the `p.one`/`p.many` builder), `defineSite`, `urlPattern`, `ExtractContext`, field functions, `ctx.lazy`, `presence`/`asset` helpers, authoring-side type-safety, minimal errors. |
| 04 | Framework — test/CLI | `@sitely/framework` | In-process test harness (the v0 checks) + the `sitely` CLI (`test` · `dev` · `snapshot`). |

### Schema foundation

**JSON Schema is the required schema definition** — the framework's boundary. Everything reads
JSON Schema: validation, annotations, and (v1) catalogue + GraphQL emission. No lossy conversion,
because JSON Schema *is* the canonical form.

- **Authoring:** **TypeBox** is the recommended tool — guides recommend it, example scrapers use
  it — because it produces JSON Schema *and* gives static TS types for free (`Static<typeof T>`).
  Any JSON-Schema-emitting tool works; **no library lock-in.** Standard Schema is an optional
  escape hatch, not the boundary.
- **Validation:** Ajv or TypeBox's compiler over the JSON Schema — a net catching "the selector
  returned the wrong shape," and (v1) the source of the drift signal.
- **Annotations = custom keywords:** `x-sitely-presence` (drift), `x-sitely-asset` (media),
  later `x-sitely-implements` (interface identity). JSON Schema is purpose-built for this.
- **Asset = typed object,** not a bare string: the value is `{ url, type }`, and the
  `asset("image")` helper emits its schema (`{ url: string, type: const "image" }` +
  `x-sitely-asset`). Self-describing on the wire; the keyword is metadata for discovery.
- **Presence is required on optional/nullable fields** — but as a `sitely test`/CI gate, not a
  run gate: `sitely dev` warns and `defineSite` never blocks. The annotation seeds G4's drift
  detection.

### In scope

- `@sitely/page`: the sync DOM interface + Cheerio and Playwright/CDP drivers + the `prepare`
  interaction API.
- `@sitely/runtime`: the driver-injected runner.
- `@sitely/framework`: the builder DSL, `urlPattern`, `ExtractContext` (`$`, `$$`, `jsonLd`,
  `params`, `lazy`), field functions with per-field error isolation, `presence`/`asset` helpers,
  the JSON-Schema validation boundary, authoring-side type-safety, a minimal error surface, the
  test harness, and the CLI (`test`, `dev`, `snapshot`).
- Three real example scrapers + their fixtures; hand-written unit fixtures; one controlled
  dynamic test page.

### Out of scope → v1

The entire server (`@sitely/server`, Postgres, Redis, cache, rate-limit, robots, auth, coalescing,
retry) · the client SDK + consumer type inference (GraphQL) · the common-interface system
(generated catalogue, `implements`, cross-site request-by-interface) · build/manifest/signing ·
pagination, locales/families, `checkResponse`, automatic captcha detection, retry disposition,
`normalizeUrl`, `ctx.fetch`, TTL · the JSDOM driver · the reliability
platform · target-site auth.

### Example scrapers

Real, hard, diverse — chosen to stress the system across different axes, **not** for convenience.
(A PoC must prove the design against *reality*; the fixture model already gives test determinism,
so controlled sandboxes buy nothing and hide the leaks real sites expose.)

| Site | Stresses | Driver | Notes |
|---|---|---|---|
| **Hacker News** | Multi-resource-per-page (`story` + `comments`), static list | Cheerio | Clean static baseline |
| **Reddit** | JS-render, scroll-to-load nested comments (`prepare`) | Playwright + `prepare` | Brutal dynamic |
| **LinkedIn** | JS-render, scroll-to-reveal job description (`prepare`), auth-walled + hostile | Playwright + `prepare` | Fixture captured from a logged-in session; framework auth is v1 |

The set is intentionally **dynamic-heavy**. LinkedIn's fixture is a manual authed snapshot —
extraction tests run against the committed HTML, so there's no auth at test time. An e-commerce
scraper (Product, accordions, variants) is a **v1** example.

### Test inputs

Three kinds; only the third is a design choice:

1. **Hand-written minimal fixtures** — tiny crafted HTML, unit-testing driver / `PageElement` /
   runner edge cases (empty element, absent attr, malformed, nesting).
2. **Real example-scraper fixtures** (above) — integration proof; run in CI off frozen HTML.
3. **One controlled dynamic test page** (accordion + scroll-load, served in CI) — the only way to
   test the live `launch → prepare → materialize` path deterministically (LinkedIn/Reddit can't
   run in CI), and it recovers *click-expand* coverage. Exercises both `prepare` sub-modes.

No general controlled-site corpus.

## v1 — outline

By priority stack:

- **G2 · Cross-site interop (marquee):** schema.org → **generated + annotated** JSON-Schema
  interface catalogue; resources declare implemented interfaces (`x-sitely-implements`); consumers
  **request a resource by interface and get it from every site that provides it.**
- **G3 · Typed consumption:** the client — strong lean **GraphQL** (interface types = common
  resources; introspection supplies types, likely dissolving heavy consumer-side TS generics).
- **Runtime:** `@sitely/server` — reuses the v0 `@sitely/runtime`; loads packages, fetches/renders,
  caches, rate-limits, robots, the seven-status wire envelope.
- **G4 · Reliability platform:** live-check cron, optional-field-selector drift alerts, fixture
  tooling (possibly its own package), the compliance suite.
- **G5 continued:** JSDOM driver; production Playwright render path; per-selector CDP perf knob if
  snapshotting proves slow.
- **Distribution:** `sitely build`, deterministic manifest, JSON Schema sidecars,
  semver-discipline, signing.
- **Ergonomics:** an **HTML→Markdown prose helper** (over `.html()`) for prose fields
  (article/job-description body); an **e-commerce example scraper**.
- **Auth:** target-site sessions/credentials (LinkedIn-class) as a framework feature.

## Locked decisions

The scope decisions behind this plan (from the design interview):

- v0 = **authoring + extraction core**; no server, no consumer.
- **Sync DOM read surface**; the backend is chosen at *render* time (static fetch vs
  Playwright/CDP render), so extraction code is backend-identical.
- **Lifecycle:** async `launch` → optional async per-page `prepare` (interaction) → `materialize`
  (settle + snapshot) → **sync** `validate`/`extract`. Fixtures capture the post-`prepare` DOM.
- **v0 drivers:** Cheerio + Playwright/CDP + `prepare`. JSDOM → v1.
- **Runner is `@sitely/runtime`**, its own package — the shared core (harness now, server later).
- **No build/manifest in v0**; in-memory `SiteDefinition`; `sitely test` runs TS in-process.
- **Type-safety: authoring-side only**; consumer inference deferred (likely GraphQL).
- **Schema:** JSON Schema **required**; TypeBox **recommended**; annotations as custom keywords;
  assets as typed `{ url, type }` objects; validation via Ajv/TypeBox; Standard Schema demoted to escape hatch.
- **Common interfaces (G2):** v1 headline; v0 keeps the seam open.
- **Example scrapers:** Reddit, LinkedIn, HN. E-commerce → v1.

## The spec template

Every `plan/NN-*` page has the same six sections:

| Section | What it pins |
|---|---|
| **Purpose & dependencies** | What the component is for; what it imports from earlier specs. |
| **Public interface** | The canonical type/signature set — the single source of truth. |
| **Invariants** | Properties that must always hold, as assertions. |
| **Behaviour & edge cases** | Every failure mode, race, malformed input, boundary condition. |
| **Acceptance criteria** | The test plan — the cases that prove the contract. Definition of done. |
| **Open questions** | Anything unresolved, surfaced rather than buried. |
