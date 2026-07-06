# Constitution — plan

> A plan for writing the project's foundational document. This file is **the plan**, not the constitution itself. We iterate on this until the structure is right, then drafting starts in parallel.

---

## Scope decision (locked by user)

**Immediate near-term focus: automated CI for community-site PRs.** Nothing else is being built right now.

User's framing:
- A community-site PR merges if (and only if) the automated CI suite passes. Authors and self-hosters can use the merged code however they like — no restrictions.
- The managed service is **not being built yet** and is backlogged. All managed-service-runtime concerns (verified-attestation tiers, endorsed-tier semantics, signing chain, revocation feeds, runner-side telemetry, the webapp directory) move to backlog.
- This sidesteps the verified-semantics conflict entirely — it's a managed-service problem, deferred.

What this changes about the plan:
- Sections 5 (quality & trust) and 6 (governance) **shrink dramatically** for v0. Only the parts that gate community-site PRs survive in the immediate constitution; the rest stays as backlog notes.
- §5 v0 = the **CI test suite spec** (crucible's must-pass list, scoped to what gates a PR merge).
- §6 v0 = the **community contribution flow** (PR-to-own-repo + automated CI gate). The governance amendment process, sign-off matrix, CoC, succession, COI — all stay relevant but lower priority for v0; aim to draft them but don't block on them.
- §2 (architecture) is the prerequisite for §5 because CI tests need to know what they're testing against. Architecture deep-dive (#4e9dc8fa) reopened with narrowed scope.

What still matters in v0:
- Framework architecture (DSL, manifest format, sandbox model) — defines what CI tests against
- Community-site package shape (`<name>-site-*`)
- Shared CI template community repos consume via `workflow_call`
- Site-author CLI (`<name> init`, `dev`, `test`, `check`, `snapshot`, `build`, `migrate`) — forge's brainstorm is canonical
- Project name + license — needed to create the npm scope and GitHub org
- The contested verified-semantics decision — **resolved by deferral.** Not a v0 question.

---

## What the constitution is for

A single document (or set of co-authored docs) capturing:

- **What this project is** and what it isn't
- **How the pieces fit together** — framework, runner, sites, managed service
- **The rules that don't change easily** — DSL contract, packaging conventions, trust model, governance
- **What's deliberately deferred** — explicit list of non-decisions so we don't accidentally re-decide them later

The constitution is what we point at when someone asks "is this in scope?" or "how do we decide X?". It's also what a contributor reads on day one before they touch code.

It is **not** an architecture spec, a roadmap, or a design doc. Those are downstream artifacts — the constitution defines the shape they must take.

---

## Sections of the constitution

| #  | Section                          | Owner       | Status                               | Depends on |
|----|----------------------------------|-------------|--------------------------------------|------------|
| 1  | Mission & scope                  | team-lead   | DRAFT NEEDED — needs user sign-off   | —          |
| 2  | Architecture & primitives        | atlas       | PRE-THOUGHT (task #4e9dc8fa)         | 1          |
| 3  | Packaging & distribution         | atlas       | POSITIONS LANDED                     | 1, 2       |
| 4  | Developer experience (CLI, scaffolding, local dev) | forge | BRAINSTORM COMPLETE — positions below | 2          |
| 5  | Quality & trust (tests, signing, revocation) | crucible | BRAINSTORM COMPLETE — positions below | 2, 3       |
| 6  | Governance & contribution        | argus + team-lead | BRAINSTORM COMPLETE — positions below; argus owns cross-section sync (§3/§5/§6) | 3, 5       |
| 7  | Identity & licensing             | team-lead   | LOCKED — name = `sitely`, license = Apache 2.0 | 1   |
| 8  | Roadmap & phasing                | team-lead   | LAST — synthesizes everything        | 1–6        |
| 9  | Open questions & non-decisions   | team-lead   | LAST — collated from all sections    | all        |

---

## Aligned positions (snapshot)

Decisions and directions @atlas, team-lead, and the user have already converged on. These go into the constitution without re-litigation unless someone surfaces a real objection.

### Project shape

- **Three products in one ecosystem:** community-driven SITE CORPUS (the focus and the moat), open-source RUNNER (self-host or use as reference), private MANAGED SERVICE (cache-as-moat at scale).
- **Future managed service is just runner + cache for v1.** Proactive scraping, federation, and other managed-only complexity is parked.
- **Schema.org is the interop target, not the source of truth.** Site authors implement schema.org-compatible schemas in whatever runtime-validation library they prefer.

### Packaging

- **Org packages:** `@<name>/site-wikipedia` (one per site, no domain encoding).
- **Community packages:** `<name>-site-*` prefix.
- **Site families allowed but per-origin is default.** Family eligibility requires literal HTML structural identity, gated by a CI structural-identity check, with per-origin trust state and explicit origin declaration. SaaS templates (Shopify-style) use a shared utility lib instead of a family package.
- **Repo topology:** three repos — core monorepo (framework, page, runner, client, CLI, schema helpers), org-sites monorepo (`packages/site-*`, independent versions), private managed-service repo. Community sites live in their own repos with a shared CI template included via `workflow_call`.
- **Canary sites in `examples/`** within the core repo to give framework-CI a regression smoke test.

### Schemas

- **Standard Schema** as the validation contract — site authors choose Zod / Valibot / ArkType / etc.
- **Build-time JSON Schema emission** as the introspection artifact — what the directory consumes for "this site provides Article with these fields".
- Helper layer providing schema.org-shaped schemas in Standard Schema form.

### Resource model

- **Scoped resource identifiers** (`wikipedia:article`) — no global namespace landgrab.
- **Global "schema-type → providers" index** — same data powers the directory's "find a site for X" surface.
- **Pages → resources mapping** formalised so one URL can yield multiple resources.

### Multi-language

- One package per site, never per language.
- DSL declares `locales: { source: 'host'|'path'|'query', values: [...], pattern: '...' }`.
- **Domain becomes a derived value** — site def declares site identity + locale strategy, active origins fall out.
- Cache key always includes locale.
- Robots.txt is per-origin (spec-mandated); locale-in-host = N fetches, locale-in-path = 1.
- Rate limits configurable per-scope (`origin` vs `site`), default per-origin for separate-host locales.

### Trust

- **Verification is published metadata; enforcement is a runtime policy.** (Code-signing analogy.)
- **Verified attestation** exists for both org and community packages from day one — universal badge in the directory.
- **Verified-required loading** is managed-service only in v1; self-hosters trust their lockfile. Opt-in `--require-verified` for self-hosters comes later.
- Signed manifest chain: *signed manifest → commit hash → npm provenance → tarball*. Any broken link refuses to load.
- **Build-time manifest** as the unified primitive: powers directory rendering, trust signing, runner startup cross-check, and framework-version compatibility.
- **Per-origin trust within families** — adding a new origin to an existing family package starts unverified until tests pass.
- Revocation: signed feed published by directory, runner polls. Conservative defaults; tradeoffs flagged not solved in v1.
- **Community OIDC identity-pin migration:** policy ("re-verification request, manual review"), not a self-service tool in v1.

### TTL

- Site def declares default TTL per resource.
- Clients override per-request OR per-page.
- Framework-level sanity bounds (min/max), warnings on suspicious choices (long TTL on a feed-shaped resource).

### Governance posture

- **Reactive ToS only.** No proactive enforcement; takedown requests considered case-by-case. Codified loudly in the constitution: *"We do not proactively police site packages for ToS compliance. Site authors are responsible for the legality of their packages in their own jurisdictions."*
- **CLI required for site authors** so local testing doesn't depend on CI.

### License direction

- **Apache 2.0** across the board (atlas's recommendation: patent grant matters, enterprise rubber-stamps).
- BSL-time-deferred-Apache (Sentry-style) held in reserve only if a hosted competitor stands up.

### Developer experience (from forge brainstorm)

- **CLI surface (essential):** `<name> init` (scaffolder, matches `npm init` muscle memory), `<name> dev` (sub-second iterate loop — watches index.ts + fixtures, re-runs extraction on every save, prints diff vs previous result), `<name> snapshot <url>` (one-off fixture capture), `<name> check` (fast static validation: schema shape, page patterns match examples, TTL bounds, `normalizeUrl` idempotent, fixtures cover declared pages — sub-second, no network), `<name> test` (vitest only, narrowed — no schema/conformance overload).
- **CLI surface (additional):** `<name> try <url>` (one-shot live extraction, prints JSON), `<name> diff <url>` (re-fetch fixture, diff vs stored — primary maintenance loop signal), `<name> doctor` (env sanity check), `<name> build` (manifest emission + JSON Schema export, prerequisite for sign), `<name> publish` (build + sign + npm publish in one step — **fails closed if signing config is missing**).
- **Migration commitment:** every breaking DSL change ships with a working codemod. The CLI surface (`<name> migrate`, sub-commands per version pair) implements the commitment. Codemods live in `@<name>/migrate` as a versioned package — runnable across multiple major versions, not one-shot scripts that bit-rot.
  - **v0 stance:** the commitment is **conditional on external authors existing.** Until then, breaking DSL changes are acceptable without codemods — the DSL is allowed to thrash freely while the design settles. Building codemods over an empty target set burns time and creates rot (un-exercised codemods drift from the DSL they claim to migrate).
  - **Activation criterion:** the rule turns on at **first npm publish of any `@sitely/*` package an external author could install and write against** (i.e. framework or runner publication; org-curated `@sitely/site-*` packages alone don't trigger, since we control them and rewrite in lockstep). From that point forward, every breaking DSL change ships with a working codemod, no exceptions.
  - Live example: the v1→v2 codemod that lived in #0c0f10a0 was reverted in #24677468 because it had zero real targets. That revert is the live application of the v0 stance — not a contradiction of the eventual rule.
- **5-minute scaffolder happy path:** `npm create <name>-site example.com` → 2 interactive questions (example URL, one field to extract) → auto-runs snapshot → generates `index.ts` with ONE working resource + page hitting a sensible default selector → uncommented test that asserts non-empty → `<name> test` goes green by minute 2:00. Generated code is real, never stub. README is short (3 sections), one `// 🛠 START HERE` marker.
- **`dev` loop contract:** sub-second selector iteration. Re-runs in <100ms on file change, prints diff vs previous result, status line shows `✓ N fixtures × M pages = X extractions, all schema-valid (Yms)`. `--live` mode swaps fixture loop for live network with session-cached responses.
- **Constitutional rules from DX brainstorm:**
  - **Error message contract:** every framework error names (a) which resource/page/site, (b) the concrete value that caused it, (c) the one-line fix. No raw stack traces escape into author space.
  - **Debugging affordance:** `ctx.debug(...)` is the one well-known affordance that prints structured into the dev pane. Lint rule (shipped with framework) fails CI on committed `ctx.debug` calls.
  - **Replayability:** every `dev`/`test`/`check` failure prints a one-line repro command.
  - **No telemetry by default.** The CLI is silent on the network unless explicitly told otherwise. Earned-trust signal.
  - **`diff` is one primitive in two contexts:** authors invoke interactively while iterating; CI/scheduled infra (if/when added) calls the same code path on a cron. Same implementation, different invocation. (Crucible converged on this independently — keep author-side CLI in v1, no scheduled-CI version yet.)

### Quality & trust (from crucible brainstorm)

- **Must-pass test categories** for `verified` badge:
  1. Fixture-based extraction matches expected output
  2. Schema conformance (output validates against declared schema)
  3. **Determinism check** (same fixture in → byte-identical output, run twice — catches `Date.now()`, `Math.random()`, undefined iteration order)
  4. **Schema-emission round-trip** (emitted JSON Schema validates the fixture output — catches drift between declared and actual shape)
  5. **Locale matrix** (if def declares `locales`, harness runs across at least two declared locales)
  6. **Error-path coverage** (at least one fixture for "page exists but resource is absent"; site def declares the contract — null/throw/partial)
  7. **Manifest integrity** (regenerated manifest from source must be byte-equal to checked-in version)
  8. **Security smoke** (static AST scan for `eval`, `new Function`, `child_process`, raw `fs`/`net` outside declared capabilities) — fast pre-check
- **Warning-only** (block badge if persistent, don't block install): performance budget, TTL plausibility, fixture freshness age (warn >90d, fail at 365), declared-resource fixture coverage.
- **Sandbox-as-constitutional-rule:** *"Capability declarations are tested by execution, not by static scan alone — the test harness IS the sandbox."* Tests run in the same isolated context the runner uses (vm context, declared capabilities only, no ambient `fs`/`net`/`process`). Collapses security smoke + capability validation + sandbox into one mechanism.
- **Drift detection combo (in cost/value order):**
  1. Runner-side telemetry (sample N% of live extractions, validate against manifest schema) — on by default for managed, opt-in for self-host. Highest leverage signal.
  2. Scheduled CI re-run weekly against live URLs (one fixture per site, schema-shape diff not byte diff). Failure files an issue, demotes badge to "drift suspected".
  3. Community "report broken" endpoint in directory.
- **Overkill (rejected for v1):** automated fixture refresh + diff alert on every push. Non-meaningful HTML drift causes alert fatigue.
- **Manual sign-off scope (what humans check that automation can't):**
  - Capability vs. behaviour mismatch (declared `[http]` but code looks like fingerprinting)
  - Selector fragility / "scraping smell"
  - Site-identity judgement (reputable / gray / hostile bucket)
  - README/docs sanity
- **Anti-bottleneck mechanisms:**
  - **Async verification:** packages publish as `unverified` immediately and are usable. Manual review queue runs on its own clock. Verified badge attaches when complete. No "blocked on a human" failure mode.
  - **Two-tier reviewer pool:** trusted-author lane (maintainers with N verified packages get fast-track / approval-by-default with 7-day objection window). New authors get full review.
  - **Review checklist as code:** generated checklist (capability list confirmed, selectors acceptable, README present, identity bucket assigned) attached to manifest signature.
  - **Re-verification only on surface-area change:** patch bumps don't trigger re-review. New capability/origin/resource does. Most updates skip the queue.
- **Revocation triggers (named in constitution):** proven malicious behaviour, undeclared capability use detected via runner telemetry, supply-chain compromise (npm advisory), **rights-holder takedown request** (covers DMCA, GDPR right-to-erasure, regional equivalents). Each gets a different default action: quarantine, downgrade-to-unverified, hard-revoke.
- **Dispute path:** documented appeal process for any package that's demoted/revoked. One sentence in constitution, one issue template in directory repo.
- **Directory states:** `verified`, `unverified`, `drift suspected`, `revoked` — surfaced distinctly in directory UI.
- **One-sentence definition of "verified":** *"Tests passed at publish time, capabilities match behaviour, and a human reviewed the code."* (Note: argus pushed back on this — see Contested decisions.)

### Governance & contribution (from argus brainstorm)

- **Asymmetric contribution paths (deliberate):**
  - **Community is the default front door.** Anyone publishes `<name>-site-foo` to their own repo + npm. No PR, no permission, no waiting on us. Directory indexes them automatically once they pass structural manifest check + verified-attestation flow. Friction here kills the moat.
  - **Org-sites is curated, NOT open submission.** External contributors do NOT PR `@<name>/site-foo` into existence. Ship as community first. "Adoption into org" is a separate later motion (maintainer-initiated, requires existing community traction + stable maintainer + matching quality bar).
  - **Adoption ≠ acquisition:** original author becomes the org-package maintainer or gets credited and replaced; community package gets deprecated with directory redirect.
  - **SLA for org-sites PRs:** existing-maintainer PRs get normal triage. External "new package" PRs are declined with redirect to community path. Bug fixes/improvements to existing org packages: ~1 week first response, no merge SLA.
  - **Constitutional non-design:** the directory MUST NOT visually privilege org packages beyond surfacing the verified attestation. If org gets a UI prestige bump, the asymmetric design lies and contributors will still try to PR org-sites.
- **Three-weight breaking-change framework:**
  - **Trivial / additive:** PR + atlas approval. No RFC.
  - **Breaking with mechanical migration:** mini-RFC as markdown PR, 14-day comment, lead + atlas sign-off, MUST ship working codemod (no codemod, no merge). *(Subject to the v0 stance in DX → Migration commitment until activation criterion is met.)*
  - **Breaking with semantic ambiguity (no clean codemod):** full RFC, 30-day comment, lead + atlas + crucible sign-off, public note pinged to known site authors via directory. No "community vote" theatre — published objections from site authors carry weight proportional to how many sites they maintain.
  - Every breaking change ships a deprecation warning at least one minor version before removal, surfaced via CLI on next run.
- **Constitution amendment sign-off matrix:**
  - §2 Architecture, §3 Packaging — atlas + lead
  - §4 DX — forge + lead
  - §5 Quality & trust — crucible + lead
  - §6 Governance — **unanimous team (atlas + crucible + forge + argus + lead).** Lead has no tiebreaker on §6. If team can't agree, status quo wins. Hedge against clique entrenchment.
  - §1 Mission, §7 Identity & licensing — lead + user (effectively user-locked)
  - §8 Roadmap, §9 Open questions — lead can edit unilaterally; working sections.
- **Quarterly constitution audit** (argus owns, recurring board task) — compare doc claims against current code/state. Stale claims fixed in code or amended out.
- **Day-one contact for the constitution:** CLI `<name> init` prints a one-paragraph summary + link. Every repo's CONTRIBUTING points at the relevant section. The only time you can guarantee someone reads it.
- **Amendment changelog discipline:** every amendment PR that removes or changes a previously-stated non-decision MUST add a changelog entry in §9. Preserves the "why we decided this" trail.
- **Code of Conduct:** Contributor Covenant 2.1 verbatim. Enforcement: lead + one other team member, two-strike (warning then removal). Documented appeal path.
- **Maintainer succession:** every named role (lead, atlas, crucible, forge, argus) — 90 days of no commits/reviews → role marked vacant, remaining team co-opts replacement by majority. Lead succession requires user sign-off.
- **Conflict of interest:** anyone reviewing a package they maintain or are paid to maintain MUST disclose in the review. Anyone with commercial interest in a competing managed service recuses from §3/§5 amendments. (Will matter the day a hosted competitor appears.)

---

## Open questions blocking the plan

These need user input before sections can be drafted. Listed in order of how much they unblock.

1. ~~**Project name.**~~ **LOCKED: `sitely`** (npm org `@sitely` available). User noted: future find-and-replace possible if needed.
2. ~~**License confirmation.**~~ **LOCKED: Apache 2.0.** LICENSE file added at repo root.
3. **Should the constitution be one document or several co-published docs?** Lead recommendation: one document with sections. Still pending user call.
4. **What are non-negotiable principles the constitution must encode?** Still open. Seeded examples: robots.txt enforcement default-on, no telemetry without opt-in, no proactive ToS policing. User to volunteer additions or confirm the seeded list.
5. ~~**Phase 1 scope.**~~ **LOCKED by lead** (user delegated): see "Phase 1 scope (locked)" subsection below.

### Phase 1 scope (locked)

User delegated this call to the lead. Phase 1 is the **minimum that delivers "automated CI for community-site PRs" end-to-end**:

- Forge's task #c9a0468d: framework primitives (`buildPackage`, `testPackage`, `validatePackage`, `snapshotUrl`) + CLI commands (`build`, `test`, `check`, `snapshot`, `validate`) + shared GH Actions workflow + Wikipedia canary site.
- Repo find-and-replace: `@wapi/*` → `@sitely/*`, CLI binary name from `wapi` → `sitely`. Forge handles as part of #c9a0468d.
- LICENSE file at repo root (done — Apache 2.0).
- Brief README update pointing to architecture spec + planning doc.

**Out of Phase 1 (becomes Phase 1.5 — the "publishable" cut):**
- `<sitely> init` scaffolder + 5-min happy path
- `<sitely> dev` sub-second iteration loop
- `<sitely> try`, `<sitely> diff`, `<sitely> doctor` author-side commands
- `<sitely> migrate` codemod tooling
- 2-3 more canary sites (one for family path — likely Stack Exchange; one Hacker News refresh)
- Docs site update with the new framework primitives + community contribution guide

**Out of Phase 1.5 (Phase 2 and beyond):**
- Webapp directory (the discovery surface)
- Manifest signing chain + npm provenance verification
- Verified attestation tier and runtime enforcement
- Revocation feed
- Managed-service runtime (cache as moat, billing, etc.)
- Drift detection / runner-side telemetry

Phase 1 is the *internal MVP* — demonstrable, tested, but not yet evangelized publicly. Phase 1.5 is the *public-launch-ready* cut.

### Contested decision — what does "verified" actually mean?

A real semantic conflict surfaced between the user's stated framing and argus's pushback. **Not a vocabulary preference — a structural choice about whether the team becomes a gatekeeper of the corpus.**

- **(a) User's original framing:** verified = automated tests pass AND human review completed. Single tier. Higher bar, slower. **Hidden cost:** every community submission becomes a queue item for the team. The "community-default, low-friction" contribution path from §6 starts to wobble. Puts the team back into gatekeeper posture — the exact posture the open-source pivot is trying to escape.
- **(b) argus's framing:** verified = chain of trust intact (manifest signed + npm provenance + automated tests pass). Add a separate **"endorsed"** tier for human-reviewed packages. Two tiers — fast lane stays fast, audit lane is opt-in. Managed service contract becomes "we only run endorsed packages." Cleaner semantics: machine-checkable claims and human judgement aren't the same thing.
- **(c) Same as (b) but different second-tier word:** "trusted by &lt;name&gt; team" or similar. Functional shape identical to (b); name is paint-bucket. Mild downside: retconning a project-name-bearing label is annoying once the name locks.

**Lead recommendation: (b).** Two-tier preserves the corpus-as-moat thesis (low friction for community), the managed service contract still works (it runs the audited tier), and the semantic discipline holds up in writing. argus mildly prefers (b) over (c) on aesthetics. Crucible's one-sentence definition (*"Tests passed at publish time, capabilities match behaviour, and a human reviewed the code."*) becomes the definition of **endorsed** under (b)/(c), not verified.

**User to call.** This is the call that most reshapes §5 and §6 drafting.

---

## Sequencing

```
[1] Mission & scope
   │
   ├─► [2] Architecture (atlas)
   │       │
   │       ├─► [3] Packaging (atlas)
   │       │       │
   │       │       └─► [6] Governance ──┐
   │       │                            │
   │       └─► [4] Dev experience (forge)
   │       │
   │       └─► [5] Quality & trust (crucible)
   │                            │
   │                            └─► [6] Governance (argus + lead)
   │
   ├─► [7] Identity & licensing
   │
   └─► [8] Roadmap (after 1-6)

[9] Open questions: collated last from each section's residue
```

Sections (2), (4), and (5) can draft in parallel after (1) is signed off. (3) needs (2). (6) needs (3) + (5). (7) and (8) bracket the work.

---

## Drafting process

1. **User locks the plan** (this doc). Iterate on structure, owners, scope before any drafting starts.
2. **Lead opens execution tasks** for each section, one per owner, with the relevant aligned-positions snapshot folded in.
3. **Owners draft in parallel** where dependencies allow. Each section is a discrete deliverable, around 1-3 pages.
4. **Argus reviews each draft** for coherence, gaps, and contradiction with adjacent sections. Cross-section conflict-of-interest sections (e.g. governance) get co-authored, not just reviewed.
5. **Lead synthesises** the section drafts into the unified constitution doc.
6. **User iterates** section by section.
7. **Lock + publish** once user signs off. Living-document amendment process documented in section 6.

ETA estimate: with parallel drafting, a publishable v0 of the constitution lands in ~4-6 hours of focused team work after the plan is locked.

---

## Living document

The constitution is meant to be amendable. Section 6 (governance) will codify how amendments work — likely PR-driven against the constitution doc, with required reviewers depending on which section is changing (architecture changes require atlas; trust-model changes require crucible; etc.).

---

## Status of this plan

Awaiting user iteration. Brainstorm prompts dispatched to forge (DX), crucible (quality), argus (governance) so they're warm by the time execution kicks off — those replies will sharpen sections 4, 5, 6 before they get drafted.
