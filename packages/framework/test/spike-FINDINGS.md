# Type-system spike (#5) — findings

**Throwaway.** A types-only prototype of the `03` DSL surface (`spike-dsl.ts`) + a real Hacker News
definition (`spike-hackernews.ts`) + type-tests, run against the **locked `@sitely/contracts`** and
**real `typebox@1.2.8`**. Delete or absorb when `03`/#10 lands. Scope was retargeted from the ticket:
the two-candidate TypeBox probe is dropped (**D1/#6 is closed** — pin is `typebox@1.2.8`), and `00` is
now built, so this de-risks **`03`** specifically.

## Verdict

**The authoring-inference chain composes and infers *sharply*.** `pnpm typecheck` + `pnpm test`
(vitest `--typecheck`) green. `ctx.params` is pinned exactly (a wrong key errors, not the wide
default); `FieldFns<Static<schema>>` catches mismatches down into nested TypeBox; `Page<E>` erases
into `defineSite` cleanly. Files: `spike-dsl.ts`, `spike-hackernews.ts`, `spike-{probe,builder,params,erasure,helpers}.test-d.ts`.

## `03`'s open questions — answered

1. **`const`-generic + builder inference → holds.** `E` is captured with exact resource names / item
   types / cardinalities (not widened to `Record<string, Binding>`); the field-function map
   type-checks against `Static<schema>` including a deep optional nested object (`poll.options[]`).
   *Nuance:* the `const` type parameter captures `E`'s properties as **`readonly`**, so the capture
   guarantee is an **assignability lower-bound** — assert with `toMatchTypeOf`, not `toEqualTypeOf`
   (a bidirectional equality false-fails on the readonly-ness). It still falsifies widening.
2. **`ExtractParams` grammar coverage → holds.** Path + query, optional segments (`:slug?`) and
   optional query pairs (`sort=:sort?`) all infer; `ctx.params` and `codec.toUrl(...)` **agree** on
   optional handling (a missing required param is a compile error, optionals are omittable). Optional
   params compose — `{ sub: string; slug?: string }` satisfies the `TParams extends Record<string,
   string>` bound under `exactOptionalPropertyTypes`, and `ExtractParams` emits `slug?: string`
   **exact** (no `| undefined`), which `toEqualTypeOf` targets must match.

## Findings to carry into `03`/#10

- **`Page<E>` erasure needs NO variance cast.** `03` §~136-140 predicts a `strictFunctionTypes` cast
  at the `defineSite` erase point. It is **moot** against the locked contracts: `Binding.extract`
  (`contracts/src/resources.ts`) takes the **default** `ExtractContext`, never `ExtractContext<TParams>`,
  so `TParams` never enters `Binding`/`Page<E>` and the specific→default assignment is plain
  covariance (verified, tsc 6.0.3). **Drop the cast** as long as `Binding.extract` keeps the default
  context. (The typed `ctx.params` comes from the *builder method* signature, not the stored binding.)
- **`TObject` ⊄ `JsonSchema`.** A `typebox` `TObject` is **not** assignable to `JsonSchema =
  Record<string, unknown>` (an interface has no implicit index signature) — verified TS2322. So the
  `resource`/`defineInterface` implementations that store `schema: JsonSchema` from a `TSchema` arg
  will need a **cast** (`schema as unknown as JsonSchema`), or `00`'s `JsonSchema` must change. This
  also means **`00`'s `schema.ts` comment "TypeBox's `TSchema` satisfies it" is misleading** — a small
  correction for the merged contracts (see cross-ticket below).
- **`resource`/`defineInterface` overload resolution — confirm.** The raw-JSON-Schema arg does yield
  `Resource<N, unknown>` (observable T=unknown holds), but which overload actually selects it is worth
  an explicit check when `03` writes the real (implemented, not declared) overloads.
- **`packages/framework` needs the `dom` lib.** It transitively pulls in the codec's `URL`-referencing
  source; base `es2023` lacks `URL`. Applied to `packages/framework/tsconfig.json` this spike (mirrors
  `contracts` + `url-codec`) — `03`/#10 keeps it.
- **`prepare?: never` error placement.** The guard fires, but tsc 6.0.3 anchors the failure on the
  whole `page({ … })` **call line** (a union-argument mismatch), and for the render-omitted case it
  elaborates about a missing `render` (it scores the dynamic arm closest). `03`'s negative tests must
  place `// @ts-expect-error` on the call line, not the `prepare:` property.

## `typebox` 1.x notes

- `import Type from "typebox"` (**default** export for the builders); `Static` / `TSchema` / `TObject`
  / … are **named type exports** — so the spec's bare `Static<S>` resolves with no rename churn.
- The package's `"."` export has **no explicit `types` condition** (top-level `types` is
  `./build/index.d.mts`); it resolves under `moduleResolution: bundler` here, but note it if resolution
  ever misbehaves.

## Error-message legibility (ticket concern — answered positively)

| Trigger | tsc message | Verdict |
|---|---|---|
| Wrong type on a **nested** field (`score: "nope"`) | `TS2322: Type 'string' is not assignable to type 'number'` | legible |
| `presence(schema, 1.5)` | `TS2345: … not assignable to '["presence(): rate must be a number literal in [0,1]; got", 1.5]'` | legible (message rides in the tuple) |
| `p.many` returning a single map | `TS2740: … missing … from 'FieldFns<…>[]': length, pop, push, …` | acceptable (says "wanted an array") |

## Cross-ticket

- **#7 (contracts, merged):** the `schema.ts` comment "TypeBox's `TSchema` satisfies it" is misleading
  (`TObject` ⊄ `Record<string, unknown>`). Small doc/typing follow-up — not a compile break in `00`
  itself (nothing there assigns a `TSchema` to `JsonSchema`).
- **#10 (03/DSL):** absorb `spike-dsl.ts`'s signatures; apply the findings above; delete this spike.
