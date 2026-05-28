# Publishing a site package

This page covers how to publish a [site package](/overview/glossary#site-package), what happens after, and what the four statuses mean. Before reading further, make sure you've already written a package — [Writing a site package](/guide/writing-a-site) is the starting point.

## Before you publish

Three things have to be true before you run `npm publish`.

### 1. `sitely test` passes

The test suite is eight checks. All eight must pass. From your package directory:

```bash
$ sitely test
fixture-extraction         ok      12 fixtures
schema-conformance         ok      12 fixtures
determinism                ok
schema-emission-roundtrip  ok
locale-matrix              ok      en, fr
error-path-coverage        ok      3 error fixtures
manifest-integrity         ok
semver-discipline          ok      no breaking changes
```

If any check fails, the directory will reject the package — these are the same checks that gate publication. See [The test suite](/guide/testing) for what each check does and how to fix common failures.

### 2. `sitely build` is up to date

`sitely build` produces the [build output](/overview/glossary#build-output): `dist/manifest.json` and `dist/schemas/<Name>.json` files. Both are checked into your repository and shipped with the package on npm.

Run the build right before publishing:

```bash
$ sitely build
wrote dist/manifest.json
wrote dist/schemas/Article.json
$ git add dist/
$ git commit -m "rebuild manifest"
```

The [manifest](/overview/glossary#manifest) must regenerate byte-for-byte identically — the `manifest-integrity` check verifies this. If you forgot to rebuild after editing `index.ts`, the test will fail.

### 3. README and `package.json` are sane

The directory reads your `package.json` and your README. Both should:

- **`package.json`** — list `index.ts` in `files`, include `dist/` in `files`, set `name` to either `@sitely/site-<name>` or `<author>-site-<name>`, and set `sideEffects: false`.
- **README** — describe what the package does, list the resources it produces, link to the [site definition](/overview/glossary#site-definition) source, and link to your repository.

The human review covers README sanity as one of its four checkpoints. A README that just says "TODO" or copies the template verbatim will hold up verification.

## Two ways to publish

Site packages have two publication paths, distinguished by the package name.

### Sitely-curated: `@sitely/site-*`

Packages under the `@sitely` npm scope live in the sitely organisation's monorepo. They aren't open to outside submissions; the sitely maintainers own them.

If you want a sitely-curated package, the path is to open an issue describing the site and explaining why curation matters for it. There's no PR queue for unsolicited `@sitely/site-*` submissions.

The vast majority of community contributors should not use this path. It exists for sites where sitely's maintainers want to take long-term operational responsibility — high-traffic sites, sites with hostile anti-scraping policies, family packages covering many origins, and similar cases.

### Community: `<author>-site-*`

The default path. You publish to your own npm scope or under your own username:

```bash
$ npm publish
+ alice-site-blog@1.0.0
```

You don't need permission. You don't open a PR. There's no human queue between you and a published package. The directory indexes your package automatically once it appears on npm with a `<author>-site-*` name and a valid manifest.

The community path is publish-first. The directory will note your package as [unverified](/overview/glossary#unverified) at first, run automated checks, and move it to [verified](/overview/glossary#verified) once both the checks and the human review pass.

## What happens after publish

The lifecycle from `npm publish` onward:

1. **The directory polls npm.** Within minutes of your publish, the directory detects the new version and indexes it. Your package appears with [status](/overview/glossary#status) `unverified`.

2. **Automated checks run.** The directory runs the same eight checks that `sitely test` runs, in a fresh worker against the published `dist/` and `fixtures/`. If any fails, the package stays at `unverified` and the failure reason appears in the directory entry.

3. **Human review queues.** A reviewer looks at three things automation can't see well:
   - **Selector fragility.** Are the CSS selectors in `extract` tied to brittle layout details, or do they target stable attributes?
   - **[Identity bucket](/overview/glossary#identity-bucket) assignment.** Is the site `reputable` / `gray` / `hostile`? The reviewer assigns this; you don't.
   - **README sanity.** Does the README describe the package, link the repository, and list the resources?

4. **Status moves to `verified`** once both the automation and the human review pass. This is async — the package is usable the whole time it's at `unverified`, just with a "not verified" badge in the directory.

Note that you are not blocked on a human reviewer at publish time. Your package is live and callable as soon as `npm publish` returns. The human review affects the verification badge, not availability.

## Statuses, explained

Every site package version has one of four statuses. Status is per-version: a new version of the same package starts at `unverified` and runs through the checks again.

### Unverified

The default status for a newly-published version. The package is callable through the server, but no automated checks or human review has confirmed it works yet.

**What gets a version into `unverified`:**

- It was just published.
- Automated checks haven't completed yet (usually within minutes).
- An automated check failed and the maintainer hasn't published a fix.
- The automated checks passed but human review hasn't completed yet.

**What gets a version out of `unverified`:**

- All eight automated checks pass *and* a reviewer has signed off on the four human-review items. Status moves to `verified`.
- Or: the maintainer publishes a new version, and this one is the previous version (which stays at `unverified` indefinitely, since older versions don't re-enter review).

### Verified

All eight automated checks pass and a human reviewer has signed off. The directory shows a verified badge. Consumers see this as "this package has been reviewed."

**What gets a version into `verified`:**

- It was previously `unverified`, all checks passed, and a reviewer signed off.

**What gets a version out of `verified`:**

- Drift is detected (status moves to `drift suspected`).
- A removal trigger applies (status moves to `removed`).
- A new version of the same package is published. The old version stays `verified` historically, but it's no longer the current version.

Verification is per-version. A 1.0.0 being `verified` says nothing about 1.0.1; the new version starts at `unverified` and goes through review again.

### Drift suspected

Live behaviour has diverged from declared behaviour in a way that automated checks have flagged. The package is still callable; consumers see a "drift suspected" warning in the directory.

**What gets a version into `drift suspected`:**

- Sampling of live extractions shows the result shape diverging from the schema or from fixtures' `expected.json`.
- Scheduled re-runs against the package's example URLs (`sitely check --live`) start producing failed validations or extractions.
- Consumer reports flag a specific failure that automation can reproduce.
- The framework's per-field telemetry shows the observed [presence](/overview/glossary#presence-annotation) rate of a declared-optional field diverging from the author's declared rate beyond tolerance.

**What gets a version out of `drift suspected`:**

- The maintainer publishes a new version that passes all checks against the current live HTML. The new version starts at `unverified`; the old version stays at `drift suspected` in the historical record.

[Drift](/overview/glossary#drift) is normal — sites change layouts and your selectors break. The status isn't a punishment; it's a signal to consumers and a nudge to the maintainer.

### Removed

The package version is no longer listed in the directory, and the server may refuse to load it depending on configuration. We use "removed" — not "revoked" — in user-facing docs.

**What gets a version into `removed`:**

- Proven malicious behaviour (hard removal).
- Supply-chain compromise of the package or one of its dependencies.
- A formal removal request from the site owner.

**What gets a version out of `removed`:**

- Nothing. Removed is per-version and terminal for that version. A new version of the same package starts at `unverified` and runs through checks again.

## What gets a package removed

Three causes for removal, with different processes for each.

### Proven malicious behaviour

If a package is found to be doing something hostile — exfiltrating data, mining cryptocurrency, encoding tracking pixels in extract output — the version is removed immediately. No quarantine, no notification window. The directory entry shows the removal reason.

The framework doesn't isolate site code from the server process, so the operator's `package-lock.json` is the trust boundary. Self-hosters trust what they install; the directory is what flags packages that turn out to be harmful so other operators can avoid them.

### Supply-chain compromise

If a dependency of your package — or your package itself — is compromised on npm (a hijacked maintainer account, a malicious update pushed to a dependency), the affected version range is removed.

You don't need to do anything wrong to be hit by this; it's an upstream event. The path forward is to publish a fixed version (pinning to a safe dependency version, removing the compromised dependency, etc.). The new version goes through checks as usual.

The directory entry shows the removal reason and the compromised range. Consumers can see which versions are safe to install.

### Formal removal request from the site owner

If the site owner files a formal request — DMCA notice, GDPR right-to-erasure, regional equivalent — the affected versions are downgraded by default. "Downgrade" means the package is hidden from the directory but the server may still serve cached results.

If the request specifies removal (not just downgrade), the version moves to `removed`. The server refuses to load it; the directory entry is preserved with the removal reason but the package itself is no longer indexed.

These requests are reviewed for validity. A bare "please remove this" with no legal basis isn't acted on; a formal DMCA from the site owner's authorised representative is.

## Disputing a removal

If you believe a removal is wrong — a mistaken supply-chain flag, a removal request you have grounds to contest, a malicious-behaviour flag you can refute — open an issue with the directory using the dispute template, citing the package, the action taken, and your evidence.

The dispute template asks for:

- The package name and version.
- The status change you're disputing.
- The evidence supporting your position.
- A pointer to the runtime data the directory cited, if any.

The removal action stays in effect while the dispute is reviewed. The dispute resolution is recorded in the directory entry whether the dispute is upheld or rejected.

## Editing a published package

You can't edit a published version; npm doesn't permit that. You publish a new version. What carries over depends on what changed.

### Patch versions

`1.0.0 → 1.0.1`. If nothing in the surface area changed — the set of pages, resources, schemas, or origins is identical — the new version's status carries over from the old. A `verified` 1.0.0 publishing as 1.0.1 with a typo fix in `extract` starts at `verified` (after the eight automated checks pass on the new version).

"Surface area" specifically means: the manifest's `pages` keys, `resources` keys, schemas referenced from resources, and `origins`. If any of those changed, it's not a patch even if you bumped the version that way; the [`semver-discipline`](/guide/testing#semver-discipline) check will catch it and the package re-enters review.

### Minor and major versions

`1.0.0 → 1.1.0` or `1.0.0 → 2.0.0`. Any change to the surface area, any new origin, any new resource — the package re-enters the review queue. The new version starts at `unverified` and runs through both automated checks and human review again.

The [`semver-discipline`](/guide/testing#semver-discipline) check enforces the correct bump: breaking changes require a major, additive changes require at least a minor. It diffs the new manifest against `dist/baseline-manifest.json` (the previously-published manifest) by default; pass `--baseline npm` to compare against the registry's `@latest` instead.

## What if?

### What if the site changes and my fixtures stop matching live HTML?

Two things happen. The CI checks that run on PRs still pass (they use the committed fixtures), so your CI doesn't immediately flag the problem. But the directory's drift sampling — which runs against live HTML — starts seeing divergent results. Status moves to `drift suspected`, and you get a notification through the directory.

What to do:

1. Re-snapshot the affected URLs with `sitely snapshot <url> --name <existing-name> --overwrite`.
2. Update your selectors in `index.ts`.
3. Update `expected.json` if the data shape genuinely changed (be deliberate about this — don't just regenerate it blindly).
4. Run `sitely test` until it passes.
5. Publish a new version.

The new version's checks run against current HTML, so it should leave `drift suspected` once it passes.

### What if I lose access to my npm account?

This is an npm-level problem; sitely can't solve it for you. The package on npm stays at whatever version was last published. The directory continues to serve metadata about it. New versions can't be published from a lost account.

If the account is genuinely compromised (rather than just lost), this is a supply-chain compromise — see [Supply-chain compromise](#supply-chain-compromise). The directory may remove the affected versions while you sort out account recovery.

Two preventive measures: enable 2FA on your npm account, and add an OIDC publisher (GitHub Actions or similar) so you can publish without your access token leaving CI.

### What if I want to deprecate a package?

Three steps:

1. **Publish a final version** with a deprecation note in the README. Update `package.json` with a `deprecated` field describing the deprecation.
2. **Mark the package deprecated on npm** with `npm deprecate <package> "<reason>"`. This shows the deprecation in `npm install` output.
3. **Notify the directory.** Open an issue or use the directory's "I maintain this and want to deprecate it" workflow. The directory entry will show a deprecation badge.

A deprecated package isn't removed — consumers can still install it and the server can still load it. The deprecation badge tells the directory's users to look for alternatives.

### What if I want to transfer my package to someone else?

For community packages (`<author>-site-*`), the package name includes your scope or username, so a transfer means publishing under a new name. The path is:

1. The new maintainer publishes the package under their name (`<new-author>-site-<name>`).
2. You publish a final patch version of the old name with a README pointing at the new package, and deprecate it on npm.
3. The directory eventually shows the old package as deprecated and the new package as `unverified` (then `verified` once it goes through review).

For sitely-curated packages (`@sitely/site-*`), transfers are an internal sitely matter and don't require maintainer action.

There's no in-place name transfer. The directory keys by package name, not by maintainer identity, because npm doesn't let you transfer package names without renaming.

## Read next

- **[The test suite](/guide/testing)** — what `sitely test` checks before you publish.
- **[Writing a site package](/guide/writing-a-site)** — the authoring guide.
- **[Glossary](/overview/glossary)** — every term used above.
- **[Site packages — architecture](/architecture/sites)** — the architecture-level view.
