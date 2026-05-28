# sitely

> Turn websites into structured JSON APIs.

**Design Preview** — sitely has no implementation yet. The architecture is fully specified end-to-end across the docs site before any code is written; the docs site is the source of truth for the contract every layer will follow.

## What's in this repo

```
docs/             VitePress site — the source of truth
planning/         Decision summaries and follow-up plans
LICENSE           Apache 2.0
package.json      Just the docs site tooling
```

## Reading the docs

```bash
pnpm install
pnpm docs:dev   # http://127.0.0.1:5173
```

Or read them on GitHub:

- [Overview](docs/overview/index.md) — what sitely is
- [Glossary](docs/overview/glossary.md) — every term defined once
- [Architecture](docs/architecture/index.md) — the system map
- [Future direction](docs/future/index.md) — what's intentionally out of scope today

## Contributing

The architecture is being settled before implementation. If you want to influence the shape of sitely, the productive place to engage is the documentation — read it, find what's unclear or wrong, and propose edits.

## License

[Apache 2.0](LICENSE)
