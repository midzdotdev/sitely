/**
 * Result types for the 8 must-pass CI checks (atlas spec §9).
 */

export type CheckName =
	| "fixture-extraction"
	| "schema-conformance"
	| "determinism"
	| "schema-emission-roundtrip"
	| "locale-matrix"
	| "error-path-coverage"
	| "manifest-integrity"
	| "security-sandbox";

export interface CheckFailure {
	check: CheckName;
	fixture?: string;
	locale?: string | null;
	page?: string;
	resource?: string;
	message: string;
	/** Optional structured detail (diff, validator issues, capability violation kind, etc). */
	detail?: unknown;
}

export interface CheckResult {
	check: CheckName;
	ok: boolean;
	failures: CheckFailure[];
	/** Number of items the check ran against (fixtures, pairs, locales, etc). */
	count: number;
}

export interface TestPackageOptions {
	/** Absolute path to the package root (containing package.json + fixtures/ + dist/). */
	packageRoot: string;
	/**
	 * Subset of checks to run. If omitted, all 8 must-pass checks run.
	 * Useful during authoring to skip the slow ones (security-sandbox, manifest-integrity).
	 */
	only?: CheckName[];
}

export interface TestPackageResult {
	ok: boolean;
	results: CheckResult[];
	failures: CheckFailure[];
}
