# @sitely/schemas

Zod-based, schema.org-shaped Standard Schema validators for [`@sitely/framework`](../framework/README.md) site definitions.

## Why this exists

Site definitions describe what they extract via the `schemas` map, and the framework needs both:

- A **runtime validator** that proves extracted data matches the declared shape — this is what the `schema-conformance` CI check runs (atlas spec §9 #2).
- A **JSON Schema artifact** the directory and clients can read without executing the package — this is what `sitely build` emits to `dist/schemas/<Name>.json`.

Both come from one source: a Zod schema declared in this package, exposed as a [Standard Schema v1](https://standardschema.dev) validator. Authors reference it by name from their site def's top-level `schemas` map; the framework picks it up.

The decoupling means you can swap Zod for Valibot or ArkType later without re-authoring the schemas — the framework only touches the `~standard` symbol, not Zod-specific APIs. (v0 ships only the Zod path; other vendors are TODO in `framework/src/build/schemas.ts`.)

## Schemas exported

Every schema is a Zod `ZodObject` with `looseObject` semantics (extra keys allowed) and corresponds to a schema.org type (or `Thing` itself, the base type). The `schemaOrgType` is recorded in `schemaOrgMetadata` and emitted into the manifest.

| Export             | schema.org type     | Typical use                                                         |
|--------------------|---------------------|---------------------------------------------------------------------|
| `Thing`            | `Thing`             | Base type — common fields on any entity (`name`, `url`, `description`, `image`, `sameAs`, `identifier`). |
| `ImageObject`      | `ImageObject`       | An image with metadata (`contentUrl`, `width`, `height`, `caption`, `thumbnailUrl`). |
| `Person`           | `Person`            | An individual (`givenName`, `familyName`, `email`, `jobTitle`, `birthDate`, `nationality`). |
| `Organization`     | `Organization`      | A company / nonprofit / org (`logo`, `foundingDate`, `address`).     |
| `Article`          | `Article`           | A written work — news, blog, encyclopedia (`headline`, `author`, `datePublished`, `articleBody`, `wordCount`, `keywords`, `inLanguage`). |
| `WebPage`          | `WebPage`           | A single web page (`breadcrumb`, `primaryImageOfPage`, `inLanguage`). |
| `VideoObject`      | `VideoObject`       | A video recording (`contentUrl`, `embedUrl`, `duration`, `uploadDate`, `transcript`). |
| `Product`          | `Product`           | A commercial product (`brand`, `sku`, `gtin`, `price`, `priceCurrency`, `availability`, `aggregateRating`, `review`). |
| `Recipe`           | `Recipe`            | A cooking recipe (`recipeIngredient`, `recipeInstructions`, `cookTime`, `prepTime`, `totalTime`, `recipeYield`, `nutrition`). |
| `Review`           | `Review`            | A user review of something (`reviewBody`, `reviewRating`, `author`, `datePublished`). |
| `Rating`           | `Rating`            | A numeric rating (`ratingValue`, `bestRating`, `worstRating`).       |
| `AggregateRating`  | `AggregateRating`   | Aggregate of multiple ratings (`reviewCount`, `ratingCount`).        |
| `ListItem`         | `ListItem`          | A single item in an `ItemList` (`position`, `item`).                |
| `ItemList`         | `ItemList`          | An ordered/unordered list of items (`numberOfItems`, `itemListElement`, `itemListOrder`). |

All exports also have a `<Name>Type` companion type-only export (e.g. `ArticleType`) — the Zod-inferred TypeScript type, for authors who want compile-time return-type annotations on `extract()`.

The `schemaOrgVersion` constant (currently `"27.0"`) is what `buildPackage` writes into each manifest's `schemas.<Name>.schemaOrgVersion` field. When schema.org evolves, bump this constant.

## Using a schema in a site definition

```ts
import { defineSite } from "@sitely/framework";
import { Article } from "@sitely/schemas";

export default defineSite({
  site: { id: "example", displayName: "Example" },
  origins: [{ hostname: "example.com" }],
  rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },

  schemas: { Article },              // ← declare the validator

  resources: {
    article: {
      schema: "Article",             // ← string ref into schemas above
      params: { id: { type: "string", required: true } },
      resolve: (p) => `/article/${p.id}`,
      ttl: { default: "1h", min: "1m", max: "24h" },
    },
  },
  pages: { /* ... */ },
});
```

The `schemas` map key (`"Article"`) is the name `resources[*].schema` references. Use the same name in both places, otherwise `sitely build` fails with a `missing-schema-ref` error.

## Extending a schema with site-specific fields

Use Zod's `.extend()` to add per-site refinements. The schema.org type tag is preserved because `schemaOrgMetadata` is keyed by export name, not by reference identity.

```ts
import { z } from "zod";
import { Article } from "@sitely/schemas";

const WikipediaArticle = Article.extend({
  categories: z.array(z.string()).optional(),
  lastModified: z.string().nullable().optional(),
});

export default defineSite({
  schemas: { Article: WikipediaArticle },   // ← keyed as "Article" so manifest still tags it
  // ...
});
```

If you need a non-schema.org type entirely, declare your own Zod schema and add an entry to your manifest's `schemas` map; the manifest will record `schemaOrgType: null` and the directory shows it as "custom schema, no schema.org compatibility" (atlas §1).

## Validation API

The test harness (`sitely test`) calls `validateExtraction(schema, data)` for every fixture × resource pair to run the `schema-conformance` check. You normally don't need to call it directly — but if you're wiring a custom CI step or want to validate ad-hoc:

```ts
import { Article, validateExtraction } from "@sitely/schemas";

const result = validateExtraction(Article, { headline: "Test" });
if (!result.success) {
  console.error(result.errors);
}
```

`validateExtraction` accepts any Standard Schema v1 validator (Zod / Valibot / ArkType). It rejects async results — extractors must be synchronous in their validation path. If `data` is an array, each element is validated individually so flat-array extractions (e.g. an array of HN stories) work without an `ItemList` wrapper.

## See also

- [`@sitely/framework`](../framework/README.md) — DSL, primitives, CLI, and the 8 must-pass CI checks that consume these schemas.
- [Standard Schema spec](https://standardschema.dev) — the runtime contract this package implements.
- [schema.org](https://schema.org) — vocabulary reference for the types modeled here.
