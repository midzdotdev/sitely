# CLAUDE.md

Project-local instructions for Claude Code sessions in this repo.

## What this repo is

sitely — a project that turns websites into structured JSON APIs through a corpus of declarative TypeScript site packages. **The project is in Design Preview: no implementation, only documentation.** The docs site IS the project right now.

The earlier skeleton code (`packages/`, `sites/`, `scripts/`) was deleted in favour of designing from the docs down. Don't recreate any of it speculatively — wait for the user to explicitly start implementation.

## What lives where

| Path | Contents |
|---|---|
| `docs/` | VitePress site — **the source of truth** |
| `docs/index.md` | Landing page |
| `docs/overview/` | What is sitely, glossary |
| `docs/guide/` | Consumer + author guide — writing a site, testing, publishing, consuming the API, self-hosting |
| `docs/architecture/` | Framework-developer deep dives — system overview, data flow, sandbox, manifest, per-package |
| `docs/future/` | Forward-looking work (hosted version, signing chain, directory, drift detection) — explicitly not in current scope |
| `planning/CONSTITUTION-PLAN.md` | Historical planning notes — *not* authoritative; docs win on conflict |
| `README.md` | Minimal — points at the docs |
| `LICENSE` | Apache 2.0 |
| `package.json` | Docs-site tooling only (vitepress + mermaid plugin) |

There is no `packages/`, no `sites/`, no `scripts/`, no `.github/workflows/`, no TS/lint/test config. Their absence is deliberate.

## Audience the docs are written for

Three audiences, in priority order, all addressed in present tense as though sitely exists today:

1. **API consumers (primary).** Developers calling sitely to extract data from already-created sites. The [TypeScript client](docs/guide/using-the-client.md), [HTTP API](docs/guide/consuming-the-api.md), and [self-hosting](docs/guide/self-hosting.md) pages are for them. The landing page and overview lead with this audience.
2. **Site authors (secondary).** People writing new site packages. The [writing-a-site](docs/guide/writing-a-site.md), [testing](docs/guide/testing.md), and [publishing](docs/guide/publishing.md) pages are for them.
3. **sitely contributors (tertiary).** People hacking on the framework itself. The [architecture](docs/architecture/) section is for them.

All three audiences share the [glossary](docs/overview/glossary.md), which is the canonical source of truth for terminology.

The sidebar in /guide/ shows "For consumers" first and "For site authors" second. The top nav puts Guide before Overview, Architecture, and Future.

## Ubiquitous language

The glossary defines every term sitely uses. Other docs link to glossary entries on first use rather than re-defining. Do not introduce synonyms — if the glossary calls it a "site definition", the docs do not call it a "site config".

**Banned words (replace):**
- "revocation" / "revoked" → "removal" / "removed"
- "constitution" / "constitutional" → describe the rule directly
- "keystone" → refer to the manifest by name
- "moat" / "cache-as-moat" / "corpus-as-moat" → delete entirely
- "endorsed tier" / "verified attestation" → just "verified"
- "honor system" → "trust" or rephrase
- "fail closed" → "rejects when ambiguous" or "defaults to denying"
- "wire-level identifier" → "stable name"
- "Phase 1" / "Phase 2" / "deferred" → describe what sitely does today; if a feature doesn't exist, link to `/future/`

**Tone:** plain English. Present tense. No business/strategy framing. No imagined team names (atlas, crucible, forge, argus).

## The contract for editing docs

- The docs site is the **source of truth**. No duplication — if a fact lives in the glossary, link to it.
- Write in present tense, as though sitely exists today. Even though there's no implementation, the docs read as reference for a real system.
- Cover edge cases. Each architecture contract should document failure modes, races, malformed input, boundary conditions. Each guide page should have a "What if?" section.
- Use the exact glossary terms. Link to the glossary on first use of a term per page.

## What to do / not do

**Do:**
- Edit docs freely. Iterate on prose, structure, diagrams, IA.
- Cross-link between docs pages liberally — the docs work best as a hyperlinked graph.
- Use mermaid diagrams where they aid understanding.
- Document edge cases per page.

**Don't:**
- Don't create `packages/`, `sites/`, or any implementation files unless the user explicitly asks to start coding.
- Don't restore deleted CI workflows, build scripts, or code-only configs.
- Don't write architecture docs as if the system is "being built" or "deferred to Phase 2". Write present tense.
- Don't reintroduce banned vocabulary.
- Don't add emojis to docs unless asked.

## VitePress

The site is configured in `docs/.vitepress/config.mts`. Nav has four sections: Overview, Guide, Architecture, Future. Mermaid is enabled with the dark theme. Local search is provided by VitePress.

To run locally:

```bash
pnpm install
pnpm docs:dev        # http://127.0.0.1:5273 (dev server)
pnpm docs:build      # static build into docs/.vitepress/dist
pnpm docs:preview    # serve the static build at http://127.0.0.1:5273
```

## Verifying changes

**Before committing any change under `docs/`, run `pnpm check`.** This is the single command that runs everything CI runs:

```bash
pnpm check
```

It composes:

- `pnpm docs:build` — VitePress build. Renders the static site into `docs/.vitepress/dist`. Link validation is *not* done here (`ignoreDeadLinks: true` in `docs/.vitepress/config.mts`) — Lychee is the single source of truth.
- `pnpm check:links` — Lychee link-checker against the built HTML. Catches both dead *file* links (`./missing.md`) and dead *anchor* fragments (`#nonexistent-section`).

The same `pnpm check` runs in `.github/workflows/docs-build.yml` after dependencies are installed. A passing local run means a passing CI run.

**Local prerequisite:** Lychee must be installed on `PATH`. On macOS: `brew install lychee`. Other platforms: see <https://lychee.cli.rs/installation/>. CI installs it via `taiki-e/install-action`.

If `pnpm check` fails, fix the issue before committing — do not commit with broken links or a failing build.

## When the user says "start implementing"

That's the signal to start scaffolding `packages/` etc. Until then, the architecture work is the work. Spawn implementation off the docs, not off recollection of the deleted skeleton.

## Style notes the user has corrected before

- Strip-everything-and-design-first is the chosen approach.
- The docs are how the user understands the architecture. Make them readable cold.
- Plain English. Less jargon. The user has explicitly said "I'm not dumb, but I don't know what 'revocation' means" — that's the bar.
- No marketing language. No emoji. No padding. Crisp sentences.
- Document for the system before it exists, written as though it exists. Edge cases matter.
- **The 8 check names are canonical in `docs/guide/testing.md`** (and the `CheckName` union in `docs/architecture/framework-test-pkg.md`). Other pages must echo, not paraphrase. Drift between them has happened twice — re-grep the canonical list when touching publishing.md, sites.md, or framework-build.md.
- **When the HTTP and client APIs use different field names for the same value, the wire shape is canonical.** Client wrappers should match the wire (e.g. `{ balance }`, not `{ tokens }`). Asymmetry is allowed only with an explicit ergonomics note (e.g. the client unwraps single-resource `data` payloads).
- **`revoke`/`revoked` is banned even at the architecture layer** — the function name in server.md is `removeApiKey`, the column is `removedAt`. The user-facing rule lives in the glossary; the architecture pages have to respect it too.
- **Audit task pitfalls (2026-05 audit):** check-name lists drift fastest, followed by API field names. When adding a new glossary entry, also cross-link first uses in every guide page that mentions the term — the term-without-glossary-link pattern resurfaces otherwise. Anchors like `#null_element` keep underscores; `#mediaref` is one word — verify generated slugs with the grep recipe in the audit plan if a new heading uses punctuation.
- **Builder pattern is the canonical DSL.** `defineSite({...}).resource(...).page(...).use(segment).build()`. Don't reintroduce the object-literal form. Schemas live on resources directly; `provides` is derived from extract's return keys, not declared.
- **No `provides`, no `examples`, no `schemas` (as a top-level block), no `capabilities`, no `sandbox` references.** All four are dropped from the design. The glossary's "deliberately avoids" section enumerates the full ban list — re-check it before adding new doc content.
- **Author-side `version` is imported from `package.json`**, not written by hand in `defineSite`. `sitely build` injects it into the compiled `dist/index.js` and the manifest.
- **TTL is per-resource, declared by the author.** Use named presets (`TTL.realtime`, `TTL.short`, `TTL.medium`, `TTL.daily`, `TTL.weekly`) or write a custom `{ default, min, max }`. No server-side `CACHE_DEFAULT_TTL_MS`.
- **`requestsPerSecond` uses fraction form for sub-unitary rates** — `1/5` not `0.2`. Self-documenting; just JavaScript arithmetic.
- **Field functions are functions everywhere on extract output**, even for constants: `type: () => "Article" as const`. Don't write `type: "Article"` — that breaks per-field error isolation and the field-function-everywhere consistency rule.
- **`presence()` is mandatory for `.optional()` / `.nullable()` / `.nullish()` fields.** Build fails otherwise. Always wrap and declare an expected rate; the runtime telemetry uses it for drift detection.
- **Implementation notes for engineers** live in an "Implementation notes" subsection at the end of relevant architecture pages (server.md has the canonical example covering token bucket, circuit breaker, server-wide cap). Don't put implementation details in user-facing guide pages.
- **"Design Preview"** is the canonical term for the current pre-implementation stage. Don't say "shipped", "today", "in production", "currently runs", or anything else implying running code exists. The status banner at the top of the home/overview/architecture pages makes present-tense writing safe inside the docs; outside the banner, qualify when in doubt.
- **Client unwraps `data` iff the call is resource-driven with no `include`.** `client.extract({ url })` returns the wire shape verbatim (keyed by resource name). `client.site(d).resource(name)` returns just that resource's data, unwrapped. `client.site(d).resource(name, params, { include })` returns the keyed multi-resource shape. Don't reintroduce "unwrap if single-resource" — that was the old rule, replaced because it changes the response type when a page later starts providing two resources.
- **Retry topology has two layers.** Hop 1 (client ↔ sitely server) is the client's `retry` config. Hop 2 (sitely server ↔ target website) is `extract-service`'s internal retries on `TransientError` (3 attempts, 250ms → 1s → 4s, ±25% jitter). The two never double-retry; client retries fire only on transport failure or sitely-server 5xx, not on `status: "error"` body shapes.
- **`?maxAge=<duration>` is the consumer freshness knob.** `maxAge=15m` means "I need data ≤ 15 minutes old"; the server re-extracts if the cached row is older. The resource's `{ default, min, max }` is the *author's* cache policy and is unrelated to consumer `maxAge`. There is no consumer-side `ttl` parameter — that name belongs exclusively to the resource definition.
- **`acceptStale: false` makes the call fail with `status: "error"`** when re-extract fails and only stale-cache data is available. There is no dedicated `not_fresh_enough` status — that's a previous draft that was dropped because it added a status without earning its keep.
- **No billing, no tokens, no balances, no `cost` on responses.** sitely is self-hosted; you don't bill yourself. The Postgres schema has `consumers` and `api_keys` (for auth + per-key rate limits); it does NOT have `usage_logs` or a `balance` column. There's no `/v1/auth/balance`, `/v1/auth/usage`, `/v1/admin/grant-tokens`, or `SitelyPaymentError`. The hosted-service [future direction](/future/) is where multi-tenant metering belongs.
- **`pages()` lives on `TypedSiteScope`**, not chained off `.resource()`. The pattern is `sitely.site(d).pages("category", params, { maxPages })` returning `AsyncIterable<ExtractResult<...>>`. Don't write `.resource(...).pages(...)` — that chains on a Promise and won't compile.
- **No generic-extraction fallback.** sitely doesn't carry a JSON-LD / OpenGraph / meta-tag fallback path. URLs whose hostname isn't covered by an installed site package return `status: "no_matching_site"`. The `definitionType` field is gone (every response is from a typed package). Don't reintroduce "best-effort fallback for any URL" claims.
- **The client requires `sites` at construction time.** `createClient({ baseUrl, apiKey, sites: [...] })` is the only valid shape. No dynamic `sites.add()`. No permissive `.site(string)` overload. No untyped quick-start. Codegen via `sitely-client fetch-types` is the escape hatch when direct install doesn't fit — it still produces a compile-time `sites` array passed at construction.
- **TypeScript generics don't narrow runtime data.** `extract<Article>({ url })` is a misleading pattern — the generic is erased at runtime, the wire shape is still keyed by resource name, and the type assertion lies if the runtime data doesn't match. Use the resource's Standard Schema validator (`SomeSchema["~standard"].validate(data)`) when you need runtime narrowing; otherwise let the imported `sites` drive inference.
