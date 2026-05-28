# Doc amend plan — API redesign integration

Source of decisions: [`planning/api-redesign-summary.md`](./api-redesign-summary.md). Anything below contradicting the summary is wrong and should be reconciled with the summary first.

## Context

The redesign reshapes most of the docs surface. The builder pattern replaces the literal-object DSL; capabilities and sandboxing are removed; URLPattern replaces `params + resolve`; new concepts land (segments, field functions, `ctx.lazy`, framework errors, `checkResponse`, presence annotation, named TTL presets, breaking-change check, transparent batching, site versioning). Almost every doc file needs touching.

The plan executes in phases that each leave the docs internally consistent (no broken cross-refs between phases). The build stays clean after each phase.

## Files affected (one row per file)

| File | Change scope |
|---|---|
| `docs/overview/glossary.md` | Major. Add ~12 new terms; remove all capability/sandbox terms; revise several existing entries (resource, page, fixture). |
| `docs/overview/index.md` | Examples updated to new DSL; key benefits revised. |
| `docs/index.md` (home) | Examples updated to new DSL. |
| `docs/guide/writing-a-site.md` | Major rewrite. New DSL throughout, segments, field functions, framework errors, presence, fixtures-with-params, capabilities-removed. |
| `docs/guide/testing.md` | 8-check list revised (`semver-discipline` replaces `security-sandbox`); `fixture-coverage` warning updated; single-locale skip note already present. |
| `docs/guide/publishing.md` | 8-check list revised; breaking-change check expectation; versioning lifecycle. |
| `docs/guide/using-the-client.md` | Auto-batching, concurrency options, no client-side validation, field-name parity already done. |
| `docs/guide/consuming-the-api.md` | POST batched extract, resource filter, version-mismatch 409, no field-level sparse, CORS already done. |
| `docs/guide/self-hosting.md` | Remove `REQUIRE_VERIFIED`, `VALIDATE_BEFORE_CACHE_WRITE`, `CACHE_DEFAULT_TTL_MS`; add `SERVER_MAX_INFLIGHT_EXTRACTIONS`; revise auth/admin docs already done. |
| `docs/architecture/index.md` | Diagrams updated (no sandbox subsystem; segment concept; URLPattern). |
| `docs/architecture/framework.md` | Major rewrite. Builder pattern, segments, URLPattern, field functions, `ctx.lazy`, error taxonomy, `checkResponse`. |
| `docs/architecture/framework-build.md` | `sitely build` is now a bundler step too (esbuild + version injection + baseline diff). |
| `docs/architecture/framework-test-pkg.md` | Drop sandbox content; revise check inventory; document semver-discipline. |
| `docs/architecture/sandbox.md` | **Delete** the file entirely. Update sidebar. |
| `docs/architecture/manifest.md` | Drop capability content; add version field; document baseline-manifest mechanism. |
| `docs/architecture/server.md` | Drop sandbox machinery; revise route topology (POST extract); document circuit breaker + adaptive backoff implementation notes. |
| `docs/architecture/data-flow.md` | Revise extract flow (no sandbox); add `checkResponse` step; add resource filter projection step. |
| `docs/architecture/schemas.md` | Add presence annotation as a first-class concept; mandatory-for-optional warning. |
| `docs/architecture/page.md` | Mostly stays; minor edits for response helper (`has`, `includes`). |
| `docs/architecture/sites.md` | Major rewrite. New DSL example; new check inventory; drop capability example. |
| `docs/future/index.md` | Add GraphQL section, browser extension, rate-limit discovery tool. Drop "managed sandboxing" implication (it's the home for the sandbox now). |
| `docs/.vitepress/config.mts` | Sidebar update — remove sandbox page; possibly reorganise architecture section. |
| `CLAUDE.md` | New style notes covering the builder pattern, present-tense rules, terms that are now banned (`provides`, `examples`, `capabilities`). |

## Execution phases

Each phase is internally consistent. Build runs clean after each.

### Phase 1 — Glossary refoundation

Glossary is the dependency for everything. Land it first.

- **Remove** entries: Capability, Sandbox, Sandbox policy.
- **Revise** entries: Resource (drop schemas-block reference), Page (drop provides/examples), Fixture (params-driven), Manifest (add version, drop capabilities), Test (8 checks listing updated).
- **Add** entries: Builder, Segment, URLPattern, Field function, `ctx.lazy`, Framework errors (entry per error; or one composite entry linking subtypes), `checkResponse`, Presence annotation, TTL preset, `semver-discipline`, Resource filter, Asset (renamed from Media).
- Update `Words this glossary deliberately avoids` to include the removed terms (capability, sandbox, provides, examples).

Verification: `pnpm docs:build` clean; grep for the removed terms in glossary returns nothing.

### Phase 2 — Drop sandbox content

- Delete `docs/architecture/sandbox.md`.
- Remove sandbox entry from `docs/.vitepress/config.mts` sidebar.
- Remove every sandbox-related paragraph from: `framework.md`, `framework-test-pkg.md`, `manifest.md`, `server.md`, `data-flow.md`, `writing-a-site.md`, `testing.md`, `self-hosting.md`, `sites.md`, `architecture/index.md`. Replace cross-links to sandbox with — in most cases — nothing (the content goes away with no replacement here).
- Remove `security-sandbox` check from all 8-check lists (this leaves only 7; phase 4 adds `semver-discipline`).
- Remove `worker_threads`, "lockdown", "loader hook", "watchdog" terminology from architecture docs.

Verification: `grep -ri "sandbox\|worker_threads\|capability" docs/ --include="*.md"` should return only references in `docs/future/` (managed-service entry) and `docs/overview/glossary.md` (banned-words section).

### Phase 3 — DSL refoundation (the big shape change)

Rewrite the central DSL pages with the builder pattern and all of its companions.

- **`docs/architecture/framework.md`**: rewrite the central `SiteDefinition` section. New builder shape. New types: `SiteBuilder<TResources>`, `Segment<TRequires, TProvides>`, `URLPattern<TParams>`, `ResourceDef`, `PageDef`, `FieldFn`, `Lazy<T>`, the error taxonomy. Drop `schemas: Record<string, StandardSchema>` and `provides` from PageDef. Drop `params + resolve` from ResourceDef; replace with `url: URLPattern<TParams>`. Add `derivedFrom`, `extract` with field-function constraint. Add `checkResponse`.
- **`docs/guide/writing-a-site.md`**: rewrite from the ground up. Walkthrough uses the builder pattern, URLPattern, field functions, `ctx.lazy`, segments split across files, framework errors, presence annotations, mandatory annotations for optional/nullable, fixtures with typed params + `errorCase`. Drop capabilities entirely. Drop the `schemas` block, `provides`, `examples`, manual version.
- **`docs/architecture/sites.md`**: rewrite the examples (HackerNews + Wikipedia) in the new shape. Remove capability block. Show segments. Show URLPattern.
- **`docs/architecture/page.md`**: light edits — the `PageDriver`/`PageElement` contract stays; add the `has`/`includes` helpers on the response snapshot.
- Update `docs/overview/index.md`, `docs/index.md` examples to match.

Verification: build clean; the literal-object DSL form appears nowhere in the docs.

### Phase 4 — Tests, validation, versioning

- **`docs/guide/testing.md`**: update the 8-check list (add `semver-discipline`, remove `security-sandbox`, ensure ordering matches `framework-test-pkg.md`). Add the `fixture-coverage` warning's revised semantics (any optional/nullable field needs present and absent fixtures). Add the mandatory-presence-annotation rule.
- **`docs/architecture/framework-test-pkg.md`**: update `CheckName` union; replace `runSecuritySandbox` with `runSemverDiscipline`; rewrite the eight-check table.
- **`docs/architecture/manifest.md`**: add `version` to the manifest shape; describe the baseline-manifest mechanism for breaking-change detection.
- **`docs/architecture/framework-build.md`**: rewrite to reflect new `sitely build` scope — bundles via esbuild (or comparable), injects version, emits manifest+schemas+baseline. Mention the semver-discipline check as a downstream consumer of the build output.
- **`docs/architecture/schemas.md`**: add a section on `presence(schema, rate)` annotation. Mandatory-for-optional/nullable rule. Cross-link from `writing-a-site.md`.
- **`docs/guide/publishing.md`**: update 8-check list to match. Document the breaking-change check and version-bump expectations. Drop capability-review checkpoint from the human-review four items (now three: selector fragility, identity bucket, README sanity).
- **`docs/guide/using-the-client.md`**: ensure no runtime client-side validation; document server-validation contract; document the `409` site-version-mismatch case and how `SitelyVersionMismatchError` looks.

Verification: build clean; all 8-check listings agree.

### Phase 5 — HTTP API, client, batching

- **`docs/guide/consuming-the-api.md`**: document `POST /v1/extract` with a single object OR an array. Per-entry `site` + `version` shape. Per-entry status (one bad entry doesn't poison the batch). Resource filter via `?resources=`. `409` per-batch-slot for version mismatch.
- **`docs/guide/using-the-client.md`**: document auto-batching (one tick), `concurrency` options, no field-level sparse, `?resources=` mapped to client API (decide between `{ include: [...] }` or `.resources([...])`; pick when writing).
- **`docs/architecture/server.md`**: update route topology table (`POST /v1/extract` added). Drop sandbox-related modules from the module-by-module section. Add implementation-notes subsection for: circuit breaker (Redis key shapes, state machine, threshold defaults), token bucket (Redis hash shape, atomic Lua refill+take), server-wide concurrency cap, adaptive backoff state machine.
- **`docs/architecture/data-flow.md`**: revise the runtime sequence diagram — drop sandbox box; add `checkResponse` step; add resource filter projection at response time; show batched-extract flow.

Verification: build clean; example curl calls match the documented routes.

### Phase 6 — Self-hosting + operational concerns

- **`docs/guide/self-hosting.md`**: remove `REQUIRE_VERIFIED`, `VALIDATE_BEFORE_CACHE_WRITE`, `CACHE_DEFAULT_TTL_MS`. Add `SERVER_MAX_INFLIGHT_EXTRACTIONS`. Drop "telemetry opt-in for drift detection" content since drift is now a future-direction concern (or rephrase). Drop the verified-only-mode section (the framework can't enforce trust anymore; lockfile is the trust model).
- **`docs/architecture/server.md`**: same env-var alignment.

Verification: build clean; env-var tables agree across pages.

### Phase 7 — Future direction

- **`docs/future/index.md`**: add three new entries — "GraphQL as a future API surface" (full pros/cons writeup from the summary), "Browser extension for site authoring", "Rate-limit discovery tool". Update the "Hosted version" entry to mention managed sandboxing as a service-layer concern.

Verification: build clean.

### Phase 8 — Tutorial + polish

- **`docs/guide/writing-a-site.md`**: add a `sitely dev` tutorial subsection walking through `snapshot → dev → test → build → publish` for a non-trivial example. Demonstrate per-field error isolation via the lazy field functions.
- **`docs/architecture/index.md`**: update the building-blocks diagram (remove sandbox subsystem; add segments).
- **`docs/.vitepress/config.mts`**: confirm sidebar is consistent with file changes (sandbox removed; possibly reorder "Packages" to surface `@sitely/framework` first since it's the most relevant).
- **`CLAUDE.md`**: append style notes — builder pattern is canonical, present-tense rule, banned terms (`provides`, `examples`, `capabilities`, `sandbox`), `field functions are always functions even for constants`, `requestsPerSecond: 1/5` over decimals when sub-unitary.

Verification: build clean; sidebar renders correctly; rendered tutorial flow makes sense (spot-check via preview).

### Phase 9 — Final verification

- **`pnpm docs:build`** — clean.
- **Residue grep** — `grep -rn "provides:\|examples:\|capabilities:\|worker_threads\|security-sandbox\|schemas: {" docs/ --include="*.md"` should return only matches in the glossary's banned-words section (and `docs/future/` for managed-sandbox).
- **Cross-link check** — every `[...](url)` in changed pages resolves to either an external URL or an existing anchor in the new content.
- **Glossary completeness** — every glossary cross-link from changed pages resolves to an anchor in `glossary.md`.
- **Spot-check via preview** — `pnpm docs:preview`, navigate the new authoring tutorial end-to-end, check the framework page renders the builder example, check the 8-check list matches across testing.md / publishing.md / framework-test-pkg.md.
- **Stop preview server.**

## What this plan deliberately doesn't do

- **No implementation.** This is docs only. The code described doesn't exist; we're documenting the design so that when implementation starts, the contract is fixed.
- **No new pages.** Everything lands in existing files. Future-direction entries are appended; new concepts go into existing architecture pages.
- **No IA restructuring.** Sidebar layout stays except for the sandbox page being removed.
- **No premature client codegen, GraphQL, or React adapter content.** Those stay in future-direction.

## Estimated touch count

15 docs files modified, 1 deleted, 2 planning files added (summary + this plan), 1 sidebar config edited, 1 CLAUDE.md appended. Total ~20 files.

The bulk of the work is Phase 3 (DSL refoundation) — that's the rewrite that's actually load-bearing. Phases 1, 2, 4 set up; 5–9 chase consistency and verify.

## After approval

Execute phase-by-phase. After each phase, run `pnpm docs:build` to confirm clean. After Phase 9, the redesign is fully documented and ready for whoever starts implementation.
