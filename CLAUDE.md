# CLAUDE.md

Project-local instructions for Claude Code sessions in this repo.

## What this repo is

sitely — turns websites into structured JSON through declarative TypeScript site packages.
**Design Preview: no implementation yet.** The **implementation plan under `docs/plan/` is the
source of truth** — a v0-first, build-ordered set of component specs plus a v1 outline. There is no
`packages/`, `sites/`, or `scripts/`; don't scaffold code until the user explicitly says to start
implementing.

The earlier as-if-built docs (`guide/`, `architecture/`, `overview/`, `future/`) were scrapped —
they were full-v1, present-tense, and full of logical inconsistencies. `docs/plan/` replaces them.

## What lives where

| Path | Contents |
|---|---|
| `docs/plan/` | **The implementation plan — source of truth.** `index.md` (north-stars, v0 scope, build order, v1 outline, locked decisions) + `00`–`05` component specs. |
| `docs/.vitepress/` | VitePress config, wired to `docs/plan/`. Verify with `pnpm check` (build + Lychee link-check — Lychee is the real gate; `ignoreDeadLinks: true` makes the build alone insufficient). |
| `planning/REBUILD-DECISIONS.md` | Reference: the conflict audit of the old docs + rulings that still inform v1 (server/client/manifest). |
| `planning/api-redesign-summary.md` | Reference: earlier full-system design decisions (v1 context). Superseded by `docs/plan/` on conflict. |
| `planning/archive/` | Superseded plans (old doc-amend + constitution plans). Historical only. |
| `README.md`, `LICENSE`, `package.json` | Repo minimum + docs tooling (vitepress + mermaid). |

## The plan

Read `docs/plan/index.md` first. Build order: **05 URL codec (standalone, built first) → 00 contracts
→ 01 @sitely/page → 02 @sitely/runtime → 03 framework/DSL → 04 framework/test** — spec file numbers
are stable IDs, not build positions. Each spec follows a fixed template: Purpose & deps · Public
interface · Invariants · Behaviour & edge cases · Acceptance criteria · Open questions.

## v0 — the proof of concept

v0 proves **ergonomic, declarative, type-safe scraper authoring over a backend-neutral DOM**,
in-process, **no server, no consumer**. Locked model:

- **Resources are item-shaped standalone symbols** (`resource(name, schema, { key? })`) — never
  arrays. A page produces one or many via a page **builder** (`p.one`/`p.many`) that gives extract
  typed `ctx.params`. No "derived" resources (cut — pure transforms are helpers inside `extract`).
- **Pages** = path + `render` (`static`/`dynamic`, discriminated; the static arm's `prepare?: never`
  makes `prepare` a compile error even with `render` omitted) + `validate` + optional async `prepare`
  (dynamic-only interaction) + `extract` (a builder function) + `fixtures`.
  `defineSite({ id, displayName, origin, pages })` — single origin in v0. The URL codec is a
  standalone **`URLCodec`** package (`05-url-codec.md`, built first): typed **path + query** patterns
  (`urlCodec("/item?id=:id")`), `toUrl`/`fromUrl` with origin as a call-time `base`, multi-path (one
  canonical + aliases), documented `URLPattern` deviations.
- **Extract leaves are field functions** (`() => value`), even constants — for per-field error
  isolation and drift telemetry.
- **DOM is a sync read surface** (`PageDriver`/`PageElement`, `$`/`$$`) over a **settled snapshot**;
  async work (`launch → prepare → materialize`) happens first. Static (Cheerio) and dynamic
  (Playwright/CDP, with `prepare` interaction) both feed the same sync surface, so extraction code is
  backend-identical. JSDOM is v1.
- **`@sitely/runtime`** is the driver-injected runner (the shared core the v1 server reuses). It
  builds `ExtractContext`, whose interface — with the read surface `PageElement`/`PageDriver`/`PageController` — is declared in 00 (the contracts root, so the package graph stays a DAG:
  `url-codec ← contracts ← page ← runtime ← framework`). It also implements `validateExtraction`
  (types in 00; no validator dependency in contracts).
- **JSON Schema is the required schema definition** (the boundary); **TypeBox is recommended** (guides
  + examples use it — `Static<>` gives field-level type-safety). Annotations are custom keywords
  (`x-sitely-presence`, `x-sitely-asset`). An **asset is a typed `{ url, type, format?, mimeType? }` object** (media kind + optional transport/mime; `format` on video/audio only; closed schemas). An
  **`Interface` is a named schema claim** (`{ kind: "interface", name, schema }`, minted by
  `defineInterface`) — `ctx.jsonLd(iface)` parses matching JSON-LD embeds against it (typed, validated,
  non-conforming dropped); the raw `ctx.jsonLd(type?)` reader stays `Record<string, unknown>[]`.
- **`presence()` is a test-time gate, not a run gate** — `sitely test`/CI enforce it, `sitely dev`
  warns, `defineSite` only throws on run-blockers (path parse, invalid schema, bad key, invalid origin).
- **No build/manifest in v0** — the in-memory `SiteDefinition` is the whole declaration; `sitely
  test` runs TS in-process. The **`sitely test` checks** are definition-level (`site-nonempty`,
  `page-nonempty`, `path-codec`, `resource-name-unique`) and fixture-level (`fixture-presence`,
  `fixture-extraction`, `schema-conformance`, `determinism`, `error-path-coverage`,
  `presence-coverage`, `path-url-match`).
- **Example scrapers:** Reddit, LinkedIn, HN (real, hard, dynamic-heavy). E-commerce is v1.

## v1 — outline (see `docs/plan/index.md`)

Cross-site interop by common interface (generated + annotated JSON-Schema catalogue; query a resource
by interface across sites) · GraphQL client · `@sitely/server` (reuses the runtime) · reliability
platform (live-check cron, drift alerts, compliance suite) · JSDOM driver · build/manifest/signing ·
HTML→Markdown prose helper · target-site auth.

## Working conventions

- **The plan is the source of truth.** Keep specs coherent — a change in one propagates (`00`'s types
  ripple into `01`–`04`). Cross-link specs by number.
- **Present-tense contract voice** for interfaces/invariants; imperative or Given-When-Then for
  acceptance criteria. It reads as a plan (specs + tests), not a shipped-product manual.
- **Plain English, no marketing, no emoji, crisp sentences.** Cover edge cases and failure modes in
  every spec.
- **Design Preview** — no running code exists; don't imply it does.
- Don't scaffold `packages/`/`sites/`/`scripts/` until the user says to start implementing.

## Pending

The plan is written, reviewed (four consolidated review passes), and wired into VitePress. v0
implementation has **not** started. When it does, begin with the **type-system spike** flagged in
`03-framework-dsl.md`'s open questions — a types-only `.d.ts` + type-test pass over the inference
chain (builder `const E` capture, `FieldFns<Static<schema>>`, `ExtractParams` over path+query,
`Page<E>` erasure), using the Hacker News site definition as its test case — and the codec
implementation (05), in that order.
