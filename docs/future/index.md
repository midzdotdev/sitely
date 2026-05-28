# Future direction

This page describes work that isn't currently in sitely. None of it is implemented; some of it is sketched in enough detail that the current architecture stays compatible with it; some of it is held loosely.

The point of this page is to keep the present-day architecture honest. If a current design choice quietly drifts away from a thing on this list, that's worth noticing.

## A hosted version

The currently shipped server is something you run yourself. A possible future direction is a hosted version of the same server — sitely-as-a-service for consumers who don't want to run Postgres and Redis themselves.

Architecturally, this would be the same `@sitely/server` plus operational extras:

- **Real isolation for site packages.** The self-hosted runtime runs site code in-process — the operator's `package-lock.json` is the trust boundary. A managed/hosted service runs untrusted packages from many authors on shared infrastructure; that requires isolation the framework itself doesn't provide. Likely shape: each site package's `validate` + `extract` runs in a separate process or container, with network and filesystem boundaries enforced by the service layer. The framework stays light; the isolation lives where the trust problem lives.
- Drift detection on by default (the self-hosted server defaults to off — see [Self-hosting → telemetry](/guide/self-hosting)).
- Per-tenant rate-limit tiers.
- Multi-region caches.
- Optional verified-only filtering (skip non-verified packages at load time).

Things explicitly *not* in scope even if a hosted version happens: federation across instances, pre-fetching popular URLs, per-tenant authoring of site packages inside the hosted service.

## A directory webapp

A consumer-facing webapp that aggregates published [manifests](/overview/glossary#manifest) across all site packages on npm. The current architecture is compatible with this — every site package already emits a declarative manifest that a directory could read.

Features a directory would surface:

- Search by schema.org type ("which sites provide `Article`?").
- Per-package status display ([verified](/overview/glossary#verified), [unverified](/overview/glossary#unverified), [drift suspected](/overview/glossary#drift-suspected), [removed](/overview/glossary#removed)).
- [Identity bucket](/overview/glossary#identity-bucket) tags.
- Links to per-package READMEs.

What a directory does *not* do, by design: moderate content, verify author identity, gatekeep which sites can have packages written for them.

## A signing chain

A future direction is binding each published [manifest](/overview/glossary#manifest) to its source via a chain of evidence:

```
signed manifest → commit hash → npm provenance → published tarball
```

Each link binds a different layer. A manifest can be signed; the manifest's `build.commit` ties it to a specific source commit; npm provenance ties the published tarball to a CI run on that commit; the tarball is what consumers install. Any broken link means a runner can refuse to load the package.

What the current architecture already supports for this future direction:

- `buildPackage()` is the only thing that emits a manifest.
- Manifests regenerate byte-identically from source. The `manifest-integrity` check catches drift between source and committed manifest.
- The manifest carries the source-touching commit hash.

What's still missing:

- The actual signing — likely Sigstore or similar.
- The verifier — reads the chain at directory ingest and (optionally) at runner load.
- A flag in the server for verified-only loading. The current default trusts the operator's lockfile.

## A removal feed

If a signing chain exists, a future direction is a signed feed that lists packages currently in `removed` or `drift suspected` status. Servers (and the hosted version) poll the feed and react accordingly.

Trigger types and default reactions are already named — see [Publishing → what gets a package removed](/guide/publishing#what-gets-a-package-removed). What's missing is the operational machinery: feed format, polling protocol, stale-feed fallback ("we haven't reached the feed in N hours, so we serve from the lockfile and log a warning").

## Drift detection

Tests passing once at publish time aren't enough — sites change. Three mechanisms could detect drift, in cost/value order:

1. **Runner telemetry.** Sample a fraction of live extractions; validate each against the published [schema](/overview/glossary#schema); aggregate per-resource failure rates. Highest-leverage signal because it sees real-traffic behaviour. **Off by default** on the self-hosted server; on by default if a hosted version exists.
2. **Scheduled live re-runs.** Once a week, run each package's example URLs against live origins; do a schema-shape diff against the committed expected output. Failure marks the package [drift suspected](/overview/glossary#drift-suspected).
3. **Consumer-reported drift.** A "report broken" button in a directory writes a structured report to a tracked queue.

What's explicitly **not** in scope: re-fetching live HTML on every push to compare against fixtures. Non-meaningful HTML drift creates alert noise that trains everyone to ignore the signal.

## Two-tier verification

The current single tier is just [verified](/overview/glossary#verified): eight checks pass and a human has signed off. A future split could be:

- **Verified.** Eight checks pass. No human in the loop. Fast and automated.
- **Reviewed.** Verified, plus a human signed off on the four review items ([capability vs observed behaviour, selector fragility, identity bucket, README sanity](/guide/testing#what-the-human-review-covers)).

The hosted version (if it happens) might run only `reviewed` packages by default; the self-hosted server might offer `--require-reviewed` as an opt-in flag.

This split isn't committed and may not happen. The current single-tier rule is what authoritatively applies today.

## GraphQL as a future API surface

The current API is REST + transparent client-side batching. A future direction is exposing a GraphQL surface alongside (or instead of) the REST endpoints.

**What GraphQL would give:**

- Native field selection (the current `?resources=` filter is at the resource level only; GraphQL handles arbitrary field-level selection).
- Per-field errors first-class (sitely already isolates per-field via [field functions](/overview/glossary#field-function), but a GraphQL error format makes this visible to consumers).
- Composition: ask for `article` + `comments` + the author's `profile` in one query, even when they cross resource boundaries.
- Standard introspection over the schema.

**What we'd give up to get it:**

- HTTP/CDN caching on single-GET URLs (REST keeps this; GraphQL doesn't decompose).
- Curl-friendliness for one-off calls (`POST /graphql` + body is harder to type by hand than `GET /v1/extract?url=...`).
- Type-flow-from-imports (today, consumers `import wikipedia from "@sitely/site-wikipedia"` and types flow; GraphQL clients require codegen against the server's schema).
- Lightweight client (most GraphQL clients are heavier than `fetch` + `@sitely/client`).

**What would tip us into adopting it:**

- Consumer demand for nested field selection beyond what `?resources=` gives.
- Real need for subscriptions (push delivery on data changes).
- A managed-service tier where field-level cost optimisation matters at scale.

The REST surface is designed so that the same `SiteDefinition` produced by `defineSite(...).build()` could be served via GraphQL by a separate adapter — schemas are already Standard Schema, resources are already typed, page extraction is already field-isolated. Adding a GraphQL endpoint wouldn't require restructuring the framework, just adding a translation layer in `@sitely/server`.

## Browser extension for site authoring

A browser extension that assists authoring a site package by capturing the current tab's HTML, helping the author pick selectors interactively, previewing extraction output, and writing the resulting fixture entry into the local package.

**What it would cover:**

- "Add this URL as a fixture" with one click — instead of `sitely snapshot --page <key> '<params>'` in a terminal, the extension knows the open tab's URL and writes the params automatically.
- Selector picker — click on an element in the rendered page, the extension records the selector path and the value it extracts, ready to paste into an `extract` field function.
- Live extraction preview — see what `extract(ctx)` would return for the current tab without committing a fixture.
- URLPattern matcher — when the open tab's URL doesn't match any registered page pattern, the extension suggests likely patterns based on the URL shape.

**Trade-offs:**

- Requires extension manifest, packaging, and per-browser submissions (Chrome, Firefox, Safari).
- Communication with the local package directory (probably via a small local server `sitely dev` already runs).
- Security model: the extension needs DOM access to the active tab; users grant that explicitly.

Worth doing once the framework stabilises and there are enough authors to make the per-browser overhead worthwhile.

## Rate-limit discovery tool

A long-running probe that empirically reverses out a target site's rate-limit policy and suggests `rateLimit: { maxConcurrent, requestsPerSecond }` values for a site package.

**How it would work:**

- Take a list of representative URLs from the site (the package's example/fixture URLs).
- Start at a conservative rate (e.g. one request every 5 seconds).
- Gradually increase rate and concurrency, watching for `429`, `Retry-After`, content-level rate-limit signals (the patterns `checkResponse` would catch), and connection resets.
- When throttling fires, back off and record the inferred threshold.
- After enough samples (probably an hour), emit a suggested `rateLimit` block.

**Trade-offs:**

- The probe itself is a polite scraper running for an hour. Authors run it once per site, not in CI.
- Authors should still set their own `rateLimit` based on the site's TOS and what they think the site can sustain — the tool gives a data-grounded starting point, not a recommendation that overrides judgement.
- Future hosted version could run this centrally and publish suggested values to the directory.

A standalone sub-project. The framework just needs to keep its `rateLimit` surface stable so the tool's output can be pasted in directly.

## CAPTCHA solving as an extension point

The framework's [built-in CAPTCHA detection](/architecture/framework#built-in-captcha-detection) tells consumers *when* a request hit Cloudflare, Datadome, or a reCAPTCHA widget. Telling them and *doing something about it* are different problems. The current design surfaces detection as `status: "blocked"`; a future direction is a typed hook for plugging in solvers.

**The planned shape:**

```ts
defineSite({
    ...,
    solveCaptcha: async (challenge) => {
        // challenge.service  = "cloudflare" | "datadome" | "recaptcha" | "hcaptcha" | …
        // challenge.url      — the URL that hit the captcha
        // challenge.sitekey  — extractable for reCAPTCHA / hCaptcha
        // challenge.response — the response snapshot the detector matched on
        //
        // Return one of:
        //   { kind: "token",   token: "..." }       // for interactive captchas
        //   { kind: "cookies", cookies: [...] }     // for interstitial bypasses
        //   null                                     // give up; framework throws CaptchaError as today
    },
})
```

When `solveCaptcha` is set, the framework calls it on a detection hit. On success it re-runs the page request with the solution attached (token or cookies). On failure or `null`, behaviour matches today: throw `CaptchaError`, surface as `status: "blocked"`.

**Why this is in `/future/` rather than the current design:**

- The framework should stay light. Solver infrastructure (API keys, retry budgets, billing) is operator-side or author-side, not framework-side.
- Solver service lifetimes are short — services come and go. Standardising too early annoys self-hosters who already have a preferred service.
- The right shape needs feedback from real authors trying to integrate.

**Two distinct problems the realistic options today solve:**

- **Interactive captchas** (reCAPTCHA, hCaptcha, Turnstile) — solvable via commercial APIs (2Captcha, CapSolver, Anti-Captcha, CapMonster) that return a token in 5–30 seconds for roughly $0.20–3.00 per 1000 solves.
- **Interstitial anti-bot** (Cloudflare Challenge, Datadome, PerimeterX, Akamai, Imperva) — generally need a headless browser (FlareSolverr is the community standard) or a residential-proxy network that's already cleared the challenge (Bright Data Web Unlocker, ScraperAPI, ScrapingBee).

**No adapter packages in core.** sitely won't ship `@sitely/captcha-2captcha` or similar. Site authors who need solving write the adapter for the service they pay for, or use a community-published one. This matches sitely's pattern for site packages: core is light; the ecosystem fills in.

## What the current architecture already does to stay compatible

A few choices in the current architecture exist *because* of these possible future directions:

1. **The manifest is the single shared file.** Every cross-cutting future concern (signing, directory, drift detection, runner cross-check) reads from `dist/manifest.json`. Future readers don't need new formats.
2. **The framework runtime stays light and in-process.** A future managed service adds isolation at the service layer (separate processes, containers, VMs) rather than retrofitting it into the framework. The framework's job is the contract; service-layer isolation is a deployment choice.
3. **Field-isolated extraction.** Per-field error handling and presence-rate annotations give drift detection precise signals to work with — the runtime already records what each future tool needs.
4. **No telemetry by default.** The self-hosted server is silent on the network unless an operator opts in. A future hosted version flips its own default; the self-hosted default doesn't change.
5. **Deterministic builds.** Without byte-identical regeneration, a signing chain has nothing stable to sign.
6. **Schemas for consumers, API keys, usage logs are already in Postgres.** A self-hosted operator who wants to run a paid service has the schema today; the hosted version is just an operator of those same tables at scale.

If you find yourself designing a current feature that requires *new* coordination with one of these future components, that's a signal — pause and re-check whether the current architecture is being correctly scoped.

## Read next

- [Overview](/overview/) — what sitely is today.
- [Architecture overview](/architecture/) — current technical shape.
- [Publishing](/guide/publishing) — current publishing path and status model.
