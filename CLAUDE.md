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
| `docs/plan/` | **The implementation plan — source of truth.** `index.md` (north-stars, v0 scope, build order, v1 outline, locked decisions) + `00`–`04` component specs. |
| `docs/.vitepress/` | VitePress config. **Not yet wired to `docs/plan/`** — nav/sidebar still reference deleted pages; wiring + `pnpm check` is the pending task. |
| `planning/REBUILD-DECISIONS.md` | Reference: the conflict audit of the old docs + rulings that still inform v1 (server/client/manifest). |
| `planning/api-redesign-summary.md` | Reference: earlier full-system design decisions (v1 context). Superseded by `docs/plan/` on conflict. |
| `planning/archive/` | Superseded plans (old doc-amend + constitution plans). Historical only. |
| `README.md`, `LICENSE`, `package.json` | Repo minimum + docs tooling (vitepress + mermaid). |

## The plan

Read `docs/plan/index.md` first. Build order: **00 contracts → 01 @sitely/page → 02 @sitely/runtime
→ 03 framework/DSL → 04 framework/test**. Each spec follows a fixed template: Purpose & deps ·
Public interface · Invariants · Behaviour & edge cases · Acceptance criteria · Open questions.

## v0 — the proof of concept

v0 proves **ergonomic, declarative, type-safe scraper authoring over a backend-neutral DOM**,
in-process, **no server, no consumer**. Locked model:

- **Resources are item-shaped standalone symbols** (`resource(name, schema, { key? })`) — never
  arrays. A page produces one or many via a page **builder** (`p.one`/`p.many`) that gives extract
  typed `ctx.params`. No "derived" resources (cut — pure transforms are helpers inside `extract`).
- **Pages** = path + `validate` + optional async `prepare` (interaction) + `extract` (a builder
  function) + `fixtures`. `defineSite({ id, displayName, hostname, pages })` — single host in v0.
- **Extract leaves are field functions** (`() => value`), even constants — for per-field error
  isolation and drift telemetry.
- **DOM is a sync read surface** (`PageDriver`/`PageElement`, `$`/`$$`) over a **settled snapshot**;
  async work (`launch → prepare → materialize`) happens first. Static (Cheerio) and dynamic
  (Playwright/CDP, with `prepare` interaction) both feed the same sync surface, so extraction code is
  backend-identical. JSDOM is v1.
- **`@sitely/runtime`** is the driver-injected runner (the shared core the v1 server reuses). It owns
  `ExtractContext`.
- **JSON Schema is the required schema definition** (the boundary); **TypeBox is recommended** (guides
  + examples use it — `Static<>` gives field-level type-safety). Annotations are custom keywords
  (`x-sitely-presence`, `x-sitely-asset`). An **asset is a typed `{ url, type }` object** in the data.
- **`presence()` is a test-time gate, not a run gate** — `sitely test`/CI enforce it, `sitely dev`
  warns, `defineSite` only throws on run-blockers (path parse, invalid schema, bad key).
- **No build/manifest in v0** — the in-memory `SiteDefinition` is the whole declaration; `sitely
  test` runs TS in-process. The **5 checks:** `fixture-extraction`, `schema-conformance`,
  `determinism`, `error-path-coverage`, `presence-coverage`.
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

`docs/.vitepress/config.mts` still points at the deleted pages. The next task is to **wire the
nav/sidebar to `docs/plan/`, set the site home, and run `pnpm check`** (VitePress build + Lychee
link-check) until green.
