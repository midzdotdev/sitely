import type { RejectionReason, ExtractionError } from "./errors";
import type { ValidationIssue } from "./schema";

/**
 * What @sitely/runtime returns for one extraction — a CLOSED discriminated union the harness and
 * `sitely dev` switch on (a sixth variant is a compile error at every exhaustive switch). Not the
 * server's wire envelope (v1). (Spec: 00 · Runner result.)
 */
export type RunnerResult =
	// `data` keyed by output; one → item, many → item[].
	| { kind: "ok"; data: Record<string, unknown>; fieldErrors?: FieldDiagnostic[] }
	// `validate → false` folds in here as reason: "wrong-page".
	| { kind: "rejected"; reason: RejectionReason }
	// `output` = the binding whose body threw.
	| { kind: "extraction-error"; error: ExtractionError; output?: string }
	// `fieldErrors`: thrower diagnostics when an absence is fatal.
	| { kind: "validation-error"; issues: ValidationIssue[]; fieldErrors?: FieldDiagnostic[] }
	// uncaught throw, lifecycle failure, OOM.
	| { kind: "error"; message: string };

/**
 * An isolated field-function throw. `output.field` (or `output[index].field` for `many`); `reason`
 * comes from the thrown class (`MissingDataError` → `"missing"`, `MalformedDataError` →
 * `"malformed"`, anything else → `"error"`).
 */
export interface FieldDiagnostic {
	output: string;
	index?: number;
	field: string;
	reason: "missing" | "malformed" | "error";
	message: string;
}
