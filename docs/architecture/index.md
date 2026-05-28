# Architecture overview

> **Design Preview.** sitely has no implementation yet. The architecture below is fully specified — module boundaries, data flow, contracts — so implementation can follow the design rather than the other way round. Statements like "the server loads X" describe the contract every implementation has to honour.

A five-minute mental model of how sitely turns a website into a typed JSON API. The deep dives for each subsystem live in the sidebar; this page is the map you orient against.

sitely has three layers — **author-time**, **build-time**, and **run-time** — joined by a single file that every layer reads or writes: the [manifest](/overview/glossary#manifest).

## The three layers

**Author-time.** You write a [site package](/overview/glossary#site-package): an `index.ts` chaining `defineSite({...}).use(...).build()` plus a `fixtures/` directory of HTML snapshots. You iterate with `sitely snapshot` (capture a fixture) and `sitely test` (run the eight checks against the fixtures). Nothing here talks to a server.

**Build-time.** `sitely build` compiles `src/index.ts` with the `version` from `package.json` baked in, writes `dist/index.js` plus `dist/manifest.json` and one JSON Schema per [schema](/overview/glossary#schema). The build is deterministic — same source, same bytes — so the manifest can be diffed, signed, and checked into git.

**Run-time.** `@sitely/server` loads installed site packages, indexes them by hostname, and serves an HTTP API. Each incoming URL is matched to a [page](/overview/glossary#page), fetched, then `checkResponse(response)` + `validate(ctx)` + `extract(ctx)` run in-process. Results are cached and returned as typed JSON.

## The building blocks

Everything sitely consists of, on one page:

```mermaid
flowchart TB
    Author([Site author]):::actor
    Consumer([Consumer app]):::actor

    subgraph author_tools["Author tooling — installed locally"]
        direction TB
        CLI["sitely CLI<br/>build · test · snapshot · …"]:::pkg
        Framework["<b>@sitely/framework</b><br/>defineSite + ExtractContext + types"]:::pkg
        FwBuild["@sitely/framework / build<br/>buildPackage()"]:::pkg
        FwTest["@sitely/framework / test-pkg<br/>in-process runner + 8 checks"]:::pkg
        Page["<b>@sitely/page</b><br/>page driver + page element<br/>(default: Cheerio)"]:::pkg
        Schemas["<b>@sitely/schemas</b><br/>schema.org Standard Schema<br/>validators (generated)"]:::pkg
    end

    subgraph artifact["Site package — the unit of distribution"]
        direction TB
        Src["index.ts<br/>(site definition)"]:::artifact
        Fix["fixtures/<br/>HTML + expected.json"]:::artifact
        Manifest["dist/manifest.json<br/>+ dist/schemas/*.json"]:::artifact
    end

    subgraph server["<b>@sitely/server</b> — the runtime"]
        direction TB
        Hono["Hono app + global middleware"]:::pkg
        AuthMw["auth middleware<br/>auth-service"]:::pkg
        RateMw["rate-limiter<br/>(per-key + per-site)"]:::pkg
        ExtractSvc["extract-service<br/>(orchestrator + coalescing)"]:::pkg
        CacheSvc["cache-service<br/>(hot Redis → cold Postgres)"]:::pkg
        RobotsSvc["robots-service"]:::pkg
        HC["http-client<br/>(fetches target websites)"]:::pkg
        Loader["site-loader<br/>(host → site definition)"]:::pkg
    end

    subgraph consumer_tools["Consumer tooling"]
        direction TB
        Client["<b>@sitely/client</b><br/>TypeScript SDK<br/>(types inferred from imported site packages)"]:::pkg
    end

    subgraph ext["External systems"]
        direction LR
        Redis[("Redis<br/>hot cache, rate-limit state")]:::external
        Postgres[("Postgres<br/>cold cache, API keys, usage")]:::external
        NPM[("npm registry")]:::external
        Web[("Target website")]:::external
    end

    %% Authoring
    Author -->|writes| Src
    Author -->|captures| Fix
    Author -->|runs| CLI
    Src -->|imports| Framework
    Src -->|imports| Schemas
    Framework -->|uses| Page
    CLI --> FwBuild
    CLI --> FwTest
    FwBuild -->|reads| Src
    FwBuild -->|reads| Schemas
    FwBuild -->|writes| Manifest
    FwTest -->|reads| Fix
    FwTest -->|loads| Src

    %% Distribution
    Src -->|publish| NPM
    Manifest -->|publish| NPM

    %% Server-side runtime
    NPM -->|install| Loader
    Loader -->|reads| Manifest
    Loader -->|registers in| Hono
    Hono --> AuthMw --> RateMw --> ExtractSvc
    ExtractSvc --> CacheSvc
    ExtractSvc --> RobotsSvc
    ExtractSvc --> HC
    ExtractSvc --> Loader
    HC -->|fetches| Web
    CacheSvc <--> Redis
    CacheSvc <--> Postgres
    RateMw <--> Redis
    AuthMw --> Postgres

    %% Consumer
    Consumer -->|imports| Client
    Consumer -->|imports types from| Src
    Client -->|HTTPS| Hono
    Consumer -.->|or raw HTTP| Hono

    classDef pkg fill:#3a2a4a,stroke:#b48ead,stroke-width:1px,color:#eceff4
    classDef artifact fill:#2a4a3a,stroke:#a3be8c,stroke-width:1px,color:#eceff4
    classDef external fill:#2a3a4a,stroke:#88c0d0,stroke-width:1px,color:#eceff4
    classDef actor fill:transparent,stroke:#d8dee9,stroke-width:1px,color:#d8dee9
```

Labels in **bold** are published npm packages. The boxes inside `@sitely/framework` are subsystems of that package; the boxes inside `@sitely/server` are modules within that package.

A few things to read off the diagram:

- **Six kinds of npm package.** Five sitely-published (`@sitely/framework`, `@sitely/page`, `@sitely/schemas`, `@sitely/server`, `@sitely/client`) plus the site packages — one per installed site. Site packages are normal npm packages, published either by the sitely org (`@sitely/site-*`) or by the community (`<author>-site-*`).
- **The manifest is the seam** between author-side tooling and server-side runtime. Author-side writes it; server-side reads it; the consumer's [TypeScript client](/guide/using-the-client) infers types from the site definition that produced it.
- **The TypeScript client and raw HTTP are both first-class.** Consumers pick. The HTTP API is the contract; the client is a convenience.
- **External systems are minimal.** Redis, Postgres, and the npm registry are all the server needs to operate. The target websites it fetches from are the fourth.
- **In-process extraction.** Author tooling and the server both execute the package's `validate`/`extract` in the same Node process they run in. What passes tests is what runs in production.

## The whole system

A second view, focused on the *flow* through the layers (the same components, drawn around how data moves):

```mermaid
flowchart TB
    subgraph author["Author time"]
        direction TB
        DSL["<b>Site definition</b><br/>(packages/site-*/src/index.ts)<br/>defineSite({...}).resource(...).page(...).build()"]
        Fixtures["HTML fixtures<br/>(packages/site-*/fixtures/)"]
    end

    subgraph framework["@sitely/framework"]
        direction TB
        Define["defineSite()<br/>+ types.ts"]
        Build["buildPackage()<br/>(build/)"]
        Validate["validateSite()<br/>(build/validate.ts)"]
        TestPkg["testPackage()<br/>(test-pkg/)<br/>in-process runner"]
        CLI["sitely CLI<br/>(build, test, snapshot, …)"]
        Page["@sitely/page<br/>(PageElement, CheerioDriver)"]
        Schemas["@sitely/schemas<br/>(schema.org Standard Schema)"]
    end

    subgraph artifact["The manifest"]
        direction TB
        Manifest["<b>dist/manifest.json</b><br/>+ dist/schemas/*.json"]
    end

    subgraph runtime["Run time — @sitely/server"]
        direction TB
        Loader["site-loader<br/>(host → SiteDefinition)"]
        Hono["Hono HTTP API<br/>:3000"]
        Auth["auth"]
        RateLimit["rate-limiter<br/>(per-site / per-key)"]
        Robots["robots-service"]
        Cache["cache-service<br/>(Redis hot → Postgres cold)"]
        Extract["extract-service<br/>(orchestrator + coalescing)"]
    end

    subgraph data["Data layer"]
        direction LR
        Redis[("Redis")]
        Postgres[("PostgreSQL")]
    end

    subgraph consumer["Consumers"]
        Client["HTTP client"]
    end

    DSL --> Define
    Fixtures --> TestPkg
    Define --> Build
    Define --> TestPkg
    Build --> Validate
    Build --> Manifest
    TestPkg --> Page
    Build --> Page
    Build --> Schemas
    CLI --> Build
    CLI --> TestPkg

    Manifest --> Loader

    Client -->|HTTP request| Hono
    Hono --> Auth
    Auth --> RateLimit
    RateLimit --> Extract
    Extract --> Cache
    Extract --> Robots
    Extract --> Loader
    Cache <--> Redis
    Cache <--> Postgres
    Auth --> Postgres
    Loader -->|loads compiled package| runtime

    classDef artifactNode fill:#3a2a4a,stroke:#b48ead,stroke-width:2px,color:#fff
    class Manifest artifactNode
```

## The package map

| Package | What it does | Deep dive |
|---|---|---|
| `@sitely/page` | The DOM abstraction. Defines [page driver](/overview/glossary#page-driver) and [page element](/overview/glossary#page-element) so [extract](/overview/glossary#extract) functions don't depend on Cheerio directly. The default driver wraps Cheerio; JSDOM or Playwright drivers can drop in later. | [@sitely/page](./page) |
| `@sitely/schemas` | Standard Schema validators generated from schema.org's published vocabulary. Authors import them and compose them into per-resource schemas — extend with site-specific fields, or replace entirely. | [@sitely/schemas](./schemas) |
| `@sitely/framework` | The DSL, the build pipeline, the test runner, and the `sitely` CLI. Everything between the author's source and the manifest. | [@sitely/framework](./framework) → [build](./framework-build) → [test-pkg](./framework-test-pkg) |
| `@sitely/server` | The runtime. Hono HTTP server, auth, cache, rate limit, robots service, extract orchestrator. Loads site packages by hostname and serves typed JSON. | [@sitely/server](./server) |
| `packages/site-*` | Site packages. One per site. Each ships `index.ts` (the site definition), `fixtures/` (test data), and `dist/manifest.json` (emitted by the build). | [Site packages](./sites) |

## The manifest is the single shared file

Every layer reads or writes the manifest:

- **Build** writes it.
- **Test** regenerates it from source and diffs against the committed copy — the `manifest-integrity` check.
- **Server load** reads it to register origins, cross-check the framework version range, and record the site's `version` for `409`-on-mismatch.
- **Directory** (when present) reads it to render schemas, resources, and locales.

`buildPackage()` is the only thing that emits a manifest. No other path produces one. Determinism is enforced: `build.commit` is the package's last source-touching commit; `build.builtAt` is that commit's author timestamp. Never `Date.now()`. See [The manifest](./manifest) for the full field-by-field walkthrough.

## The trust model in one paragraph

Site packages run in-process in the server and the test harness alike. The operator's `package-lock.json` is the trust boundary — the server loads what's installed, with no second policy file. This matches Node's default trust model for npm dependencies. A future managed/hosted service can add real isolation at the service layer (separate process, container, VM); the framework itself stays light. See [future direction](/future/).

## Read next

- [Data flow](./data-flow) — end-to-end traces for the author, build, and runtime flows.
- [The manifest](./manifest) — field by field.
- [@sitely/framework](./framework) — the DSL, the CLI, and the contract every site package implements.
