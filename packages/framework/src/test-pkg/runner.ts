import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { resolveCapabilities } from "../build/capabilities.js";
import { getAllHostnames } from "../origins.js";
import type { SiteDefinition } from "../types.js";
import type { Fixture } from "./fixtures.js";

export type ExtractionRunResult =
	| { kind: "ok"; data: Record<string, unknown> }
	| { kind: "capability-violation"; capability: string; attempted: string }
	| { kind: "validate-false" }
	| { kind: "error"; message: string };

export interface ExtractionRunOptions {
	site: SiteDefinition;
	siteModulePath: string;
	fixture: Fixture;
	pageKey: string;
	params: Record<string, string>;
}

/**
 * Spawn a single worker that runs `validate` + `extract` against one fixture
 * under capability constraints declared in the site's manifest.
 *
 * Returns a discriminated-union result. Capability violations always
 * surface as `kind: "capability-violation"` so consuming checks can decide
 * how to weight them (security smoke = always failure; other checks may
 * skip and let security smoke own the failure to avoid double-reporting).
 */
export function runExtractionInWorker(opts: ExtractionRunOptions): Promise<ExtractionRunResult> {
	const capabilities = resolveCapabilities(opts.site);
	const allowedHostnames = getAllHostnames(opts.site);

	// Locate the worker bootstrap. In built packages this is dist/test-pkg/worker.js;
	// during framework's own tests we can resolve relative to this file.
	const workerPath = resolveWorkerPath();

	return new Promise((resolveResult) => {
		const worker = new Worker(workerPath, {
			workerData: {
				siteModulePath: opts.siteModulePath,
				fixture: {
					name: opts.fixture.name,
					locale: opts.fixture.locale,
					html: opts.fixture.html,
					url: opts.fixture.meta?.url ?? deriveFixtureUrl(opts.site, opts.pageKey, opts.params, opts.fixture),
					status: opts.fixture.meta?.status ?? 200,
					headers: opts.fixture.meta?.headers ?? {},
				},
				pageKey: opts.pageKey,
				params: opts.params,
				capabilities,
				allowedHostnames,
			},
			resourceLimits: {
				maxOldGenerationSizeMb: capabilities.memory.maxMb,
			},
		});

		let done = false;
		const timeoutMs = capabilities.timers.maxWallMs + 5_000; // slack on top of in-worker deadline
		const watchdog = setTimeout(() => {
			if (done) return;
			done = true;
			void worker.terminate();
			resolveResult({
				kind: "capability-violation",
				capability: "timers.maxWallMs",
				attempted: `worker did not respond within ${timeoutMs}ms`,
			});
		}, timeoutMs);
		watchdog.unref();

		worker.once("message", (msg: ExtractionRunResult) => {
			if (done) return;
			done = true;
			clearTimeout(watchdog);
			void worker.terminate();
			resolveResult(msg);
		});

		worker.once("error", (err: unknown) => {
			if (done) return;
			done = true;
			clearTimeout(watchdog);
			resolveResult({
				kind: "error",
				message: err instanceof Error ? err.message : String(err),
			});
		});

		worker.once("exit", (code) => {
			if (done) return;
			done = true;
			clearTimeout(watchdog);
			resolveResult({
				kind: "error",
				message: `worker exited with code ${code} before posting a result`,
			});
		});
	});
}

function resolveWorkerPath(): string {
	const here = fileURLToPath(import.meta.url);
	// In the built dist/, this file is at dist/test-pkg/runner.js; the worker
	// is dist/test-pkg/worker.js next to it.
	const dir = here.replace(/\/[^/]+$/, "");
	return join(dir, "worker.js");
}

function deriveFixtureUrl(
	site: SiteDefinition,
	pageKey: string,
	params: Record<string, string>,
	fixture: Fixture,
): string {
	// Reconstruct a plausible URL from the page pattern + params + the
	// fixture's locale. Used only when the fixture has no .meta.json.
	let path = pageKey;
	for (const [key, value] of Object.entries(params)) {
		path = path.replace(`:${key}`, encodeURIComponent(value));
	}
	const origin = site.origins[0];
	const hostname = origin.templated && fixture.locale
		? origin.hostname.replaceAll("{locale}", fixture.locale)
		: origin.hostname;
	return `https://${hostname}${path}`;
}
