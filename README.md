# sitely

> Turn websites into structured JSON — and the web into something you can query.

**Design Preview** — sitely has no implementation yet. The **implementation plan** under
[`docs/plan/`](docs/plan/) is the source of truth: a v0-first, build-ordered set of component specs
(interface · invariants · edge cases · acceptance criteria) plus a v1 outline. Code follows the
plan; nothing is built yet.

## What's in this repo

```
docs/plan/        The implementation plan — source of truth
docs/.vitepress/  VitePress config
planning/         v1 design reference + archived plans
LICENSE           Apache 2.0
package.json       Docs-site tooling
```

## Reading the plan

Start with [`docs/plan/index.md`](docs/plan/index.md) — north-stars, the v0 scope, the build order,
and the v1 outline. Then the component specs in dependency order:

- [05 · URL codec](docs/plan/05-url-codec.md) — the standalone `URLCodec` package (built first)
- [00 · contracts](docs/plan/00-contracts.md) — shared types, the JSON-Schema boundary
- [01 · @sitely/page](docs/plan/01-page.md) — the DOM abstraction (sync read, async render)
- [02 · @sitely/runtime](docs/plan/02-runtime.md) — the extraction runner
- [03 · framework/DSL](docs/plan/03-framework-dsl.md) — `defineSite` / `resource` / `page`
- [04 · framework/test](docs/plan/04-framework-test.md) — the harness + `sitely` CLI

## License

[Apache 2.0](LICENSE)
