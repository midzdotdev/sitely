import { parentPort, workerData } from "node:worker_threads";
import { CheerioDriver } from "@sitely/page";
import { createExtractContext } from "../context.js";
import { matchPagePattern } from "../test-harness.js";
import type { SiteDefinition } from "../types.js";

/**
 * Worker bootstrap — runs a single fixture's `validate` + `extract` under
 * capability constraints declared in the manifest.
 *
 * What the sandbox enforces today (atlas spec §8 — "the test harness IS the sandbox"):
 * - `globalThis.fetch` is overridden with an allowlist driven by
 *   `capabilities.network.egress` + the site's hostnames.
 * - Memory cap via `worker_threads.Worker.resourceLimits.maxOldGenerationSizeMb`
 *   (set on the parent side from `capabilities.memory.maxMb`).
 * - Wall-clock deadline via in-worker `setTimeout(maxWallMs)` + outer parent
 *   watchdog. Runaway extractors fail as a capability violation rather than
 *   hanging the harness.
 *
 * Capability violations are posted back to the parent as
 * `{kind: "capability-violation", capability, attempted}` and turned into
 * test failures.
 *
 * Future work (NOT enforced today — capabilities documented in the manifest
 * but the worker has no enforcement code for these):
 * - Module deny-list for `node:fs`, `node:fs/promises`, `node:child_process`,
 *   `node:vm`, `node:net`, `node:dgram`, `node:tls` gated by `capabilities.filesystem`
 *   / `capabilities.process`. A site that calls `fs.readFile()` directly will
 *   succeed silently rather than fail as a capability violation. Wire this
 *   when the first community submission needs filesystem-allowed extraction.
 *
 * Honest caveat (atlas §8): worker_threads is process-internal. A determined
 * attacker can escape via native addons / runtime tricks. The harness
 * documents this — capability enforcement here catches accidents and lazy
 * mistakes, not adversaries. Real adversary defense is the deferred
 * managed-service trust pass.
 */

interface WorkerInput {
	siteModulePath: string;
	fixture: {
		name: string;
		locale: string | null;
		html: string;
		url: string;
		status: number;
		headers: Record<string, string>;
	};
	pageKey: string;
	params: Record<string, string>;
	capabilities: {
		network: { egress: "site-only" | "any" | "none" };
		filesystem: "none" | "read-temp" | "read-write-temp";
		timers: { maxWallMs: number };
	};
	allowedHostnames: string[];
}

type WorkerResult =
	| { kind: "ok"; data: Record<string, unknown>; validated: boolean }
	| { kind: "capability-violation"; capability: string; attempted: string }
	| { kind: "validate-false" }
	| { kind: "error"; message: string };

const data = workerData as WorkerInput;

void (async () => {
	try {
		// Install the fetch interceptor BEFORE loading the site module so any
		// capture of fetch happens against the stubbed version.
		const originalFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			const target = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
			const violation = checkNetworkCapability(target);
			if (violation && violation.kind === "capability-violation") {
				postResult(violation);
				throw new Error(`capability-violation: ${violation.capability} ${violation.attempted}`);
			}
			return originalFetch(target, init);
		}) as typeof fetch;

		// Load the site module.
		const mod = await import(data.siteModulePath);
		const site = (mod.default ?? mod.site) as SiteDefinition;

		const page = site.pages[data.pageKey];
		if (!page) {
			postResult({ kind: "error", message: `page "${data.pageKey}" not in site definition` });
			return;
		}

		const driver = new CheerioDriver({
			rawHtml: data.fixture.html,
			url: data.fixture.url,
			status: data.fixture.status,
			headers: data.fixture.headers,
		});
		const ctx = createExtractContext({
			driver,
			params: data.params,
			locale: data.fixture.locale,
		});

		const valid = page.validate(ctx);
		if (!valid) {
			postResult({ kind: "validate-false" });
			return;
		}

		// Run extract under a wall-clock deadline.
		const timer = setTimeout(() => {
			postResult({
				kind: "capability-violation",
				capability: "timers.maxWallMs",
				attempted: `${data.capabilities.timers.maxWallMs}ms exceeded`,
			});
		}, data.capabilities.timers.maxWallMs);
		timer.unref();

		const extracted = await page.extract(ctx);
		clearTimeout(timer);

		postResult({ kind: "ok", data: extracted, validated: true });
	} catch (err) {
		postResult({
			kind: "error",
			message: err instanceof Error ? err.message : String(err),
		});
	}
})();

function checkNetworkCapability(
	target: string,
): Extract<WorkerResult, { kind: "capability-violation" }> | null {
	if (data.capabilities.network.egress === "none") {
		return { kind: "capability-violation", capability: "network.egress=none", attempted: target };
	}
	if (data.capabilities.network.egress === "any") return null;

	// site-only — extract hostname and check against allowlist.
	let hostname: string;
	try {
		hostname = new URL(target).hostname;
	} catch {
		return {
			kind: "capability-violation",
			capability: "network.egress=site-only",
			attempted: `${target} (malformed URL)`,
		};
	}
	if (!data.allowedHostnames.includes(hostname)) {
		return {
			kind: "capability-violation",
			capability: "network.egress=site-only",
			attempted: `${target} (hostname "${hostname}" not in declared origins)`,
		};
	}
	return null;
}

function postResult(result: WorkerResult): void {
	parentPort?.postMessage(result);
}
