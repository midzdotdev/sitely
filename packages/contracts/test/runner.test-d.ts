import { expectTypeOf, test } from "vitest";
import type {
	ExtractionError,
	FieldDiagnostic,
	RejectionReason,
	RunnerResult,
	ValidationIssue,
} from "../src/index";

/**
 * Spec 00 · "Closed union" acceptance criterion (§ Runner result, invariant 6): an exhaustiveness
 * `switch` over `RunnerResult` compiles with NO `default`. `noImplicitReturns` is on, so a switch
 * that misses a variant leaves a code path with no `return` and fails to compile — therefore THIS
 * FILE COMPILING is the proof that `RunnerResult` is exactly these five variants (a sixth would make
 * `handle` non-exhaustive). A `default` clause would mask a future variant, so there deliberately is
 * none; the per-case `expectTypeOf`s prove the discriminant narrows each arm to its own fields.
 */
function handle(r: RunnerResult): string {
	switch (r.kind) {
		case "ok": {
			// `data` is the open output record; the exact-shape equality also proves `fieldErrors`
			// is OPTIONAL (`?`), not a required `FieldDiagnostic[] | undefined` — the two differ under
			// exactOptionalPropertyTypes, and toEqualTypeOf distinguishes them.
			expectTypeOf(r).toEqualTypeOf<{
				kind: "ok";
				data: Record<string, unknown>;
				fieldErrors?: FieldDiagnostic[];
			}>();
			return r.kind;
		}
		case "rejected": {
			// Exact-shape equality proves `reason` is `RejectionReason` AND that the arm carries no
			// `message` (that belongs to the `error` variant) — a stronger check than a bare access.
			expectTypeOf(r).toEqualTypeOf<{ kind: "rejected"; reason: RejectionReason }>();
			return r.reason;
		}
		case "extraction-error": {
			expectTypeOf(r.error).toEqualTypeOf<ExtractionError>();
			return r.kind;
		}
		case "validation-error": {
			expectTypeOf(r.issues).toEqualTypeOf<ValidationIssue[]>();
			return r.kind;
		}
		case "error": {
			expectTypeOf(r.message).toEqualTypeOf<string>();
			return r.message;
		}
	}
}

test("RunnerResult is a closed five-variant discriminated union", () => {
	// References `handle` (noUnusedLocals) and restates its signature; the exhaustiveness proof is
	// simply that `handle` compiled under `noImplicitReturns` with no `default` arm.
	expectTypeOf(handle).toEqualTypeOf<(r: RunnerResult) => string>();
});
