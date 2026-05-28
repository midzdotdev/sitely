---
layout: home

hero:
  name: sitely
  text: Sites you install. Typed JSON.
  tagline: One npm install per site, one call per request. Pass installed site packages to the client; domains, resource names, params, and response shapes are all inferred end to end.
  actions:
    - theme: brand
      text: Quick start
      link: /guide/using-the-client
    - theme: alt
      text: HTTP API
      link: /guide/consuming-the-api
    - theme: alt
      text: How it works
      link: /overview/

features:
  - title: Types follow your imports
    details: Install a site package, hand it to createClient, and your domains, resource names, params, and return shapes are all inferred. No codegen. Typos are compile errors.
    link: /guide/using-the-client
    linkText: Try the client
  - title: One package per site
    details: Each site is a typed extractor — declarative, audited, versioned. Add coverage by writing a package; remove a site by uninstalling it. No silent fallbacks; no surprise shapes.
    link: /guide/writing-a-site
    linkText: Write a site
  - title: Built-in defaults
    details: Hot and cold caching, request coalescing, per-key and per-site rate limits, robots.txt respected. Hand sitely a URL — the rest is handled.
    link: /guide/self-hosting
    linkText: Self-host the server
---

<div class="design-preview-banner">
  <span class="design-preview-banner__chip">Design Preview</span>
  <p>sitely has no implementation yet. The docs describe the system as it will exist; the architecture is specified end-to-end so implementation can follow the contract exactly. See <a href="/overview/">What is sitely?</a> for the bigger picture.</p>
</div>

## A 30-second look

```ts
import { createClient } from "@sitely/client";
import wikipedia from "@sitely/site-wikipedia";

const sitely = createClient({
    baseUrl: "https://sitely.example/api",
    apiKey: process.env.SITELY_API_KEY!,
    sites: [wikipedia],
});

const article = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "TypeScript" });

console.log(article.data.headline);    // "TypeScript"
console.log(article.data.categories);  // ["Programming languages", …]
```

The site, the resource, the params, and the response shape are all typed against the imported `@sitely/site-wikipedia`. Drop a package, drop the inference along with it.

The same call from anywhere else, via the HTTP API:

```bash
curl "https://sitely.example/api/v1/sites/en.wikipedia.org/article?title=TypeScript" \
    -H "Authorization: Bearer sitely_sk_..."
```

The client adds inference, retries, pagination, and cancellation. The HTTP API is the contract underneath.

## What you get

- **One npm package per site.** Each [site package](/overview/glossary#site-package) declares typed resources (`article`, `product`, `recipe`). Schemas can compose schema.org types or be fully custom — interop where useful, no ceiling.
- **No fallback path; no surprise shapes.** Every response comes from a typed site package. URLs whose hostname isn't covered return a clean error, not a best-effort guess.
- **Caching with sensible defaults.** Hot Redis + cold Postgres, per-resource TTL, consumer-side max-age control, stale data as a fallback when extraction fails (opt-out via `acceptStale: false`).
- **Request coalescing.** Ten parallel calls to the same URL trigger one extraction.
- **Rate limits on your behalf.** Per-key for fairness; per-site for politeness; surfaced as `429` with `Retry-After`.
- **robots.txt respected by default.** No flag overrides it on the server path.
- **Deterministic builds.** Site packages compile reproducibly; the published manifest is byte-identical to a clean rebuild, signed-friendly, and diffable across versions.

## Where to start

| You want to… | Start here |
|---|---|
| Call sitely from TypeScript | [Using the client](/guide/using-the-client) |
| Call sitely from any language | [Consuming the HTTP API](/guide/consuming-the-api) |
| Run sitely on your own infrastructure | [Self-hosting the server](/guide/self-hosting) |
| Add a new site | [Writing a site package](/guide/writing-a-site) |
| Understand the architecture | [Architecture overview](/architecture/) |

<style>
.VPHero .name {
	background: linear-gradient(120deg, #b48ead 30%, #88c0d0);
	-webkit-background-clip: text;
	background-clip: text;
	-webkit-text-fill-color: transparent;
}
.VPHero .text { font-size: 36px; line-height: 1.15; max-width: 24ch; }
.VPHero .tagline { max-width: 60ch; }

.VPFeature { transition: transform 0.15s ease, border-color 0.15s ease; }
.VPFeature:hover { transform: translateY(-2px); border-color: #b48ead; }
.VPFeature .link-text-value { color: #b48ead; }

/* Design Preview banner — sits between the feature cards and the 30-sec example */
.design-preview-banner {
	max-width: 1152px;
	margin: 32px auto 48px;
	padding: 18px 24px;
	background:
		linear-gradient(135deg, rgba(180, 142, 173, 0.10), rgba(136, 192, 208, 0.06));
	border: 1px solid rgba(180, 142, 173, 0.30);
	border-radius: 12px;
	color: var(--vp-c-text-2);
	font-size: 14px;
	line-height: 1.55;
}
.design-preview-banner p { margin: 0; }
.design-preview-banner a {
	color: #b48ead;
	font-weight: 500;
	text-decoration: underline;
	text-underline-offset: 2px;
}
.design-preview-banner a:hover {
	color: #c9a4c5;
}
.design-preview-banner__chip {
	display: inline-block;
	margin-bottom: 12px;
	padding: 3px 10px;
	background: #b48ead;
	color: #1a1a23;
	border-radius: 4px;
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}
@media (max-width: 640px) {
	.design-preview-banner {
		margin: 24px 24px 36px;
		padding: 16px 18px;
	}
}
</style>
