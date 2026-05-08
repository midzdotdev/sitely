# @sitely/schemas

Hand-written schema.org TypeScript types for sitely.

## Overview

`@sitely/schemas` provides TypeScript interfaces for the most common schema.org entities encountered in web extraction. Each interface maps directly to its schema.org counterpart with all fields optional (extracted data is often incomplete).

These are hand-written rather than auto-generated to keep the MVP simple and include only the fields commonly seen in practice.

## Available Types

`Thing`, `Article`, `Person`, `Organization`, `Product`, `Review`, `Rating`, `AggregateRating`, `VideoObject`, `WebPage`, `ItemList`, `ListItem`, `ImageObject`

Plus utility types: `SchemaType` (union of all types), `SchemaTypeName` (string literal union).

## Usage

```ts
import { Schema } from "@sitely/schemas";
import type { Article } from "@sitely/schemas";

// Use Schema constant in site definitions for type-safe references
const resource = {
  schema: Schema.Article,
  // ...
};

// Use types for extracted data
const article: Article = {
  "@type": "Article",
  headline: "Example",
  author: "Jane Doe",
};
```
