import { expectTypeOf, test } from "vitest";

// Canary: proves the vitest --typecheck type-test harness runs, which the
// type-system spike (#5) depends on. Replace with real inference assertions.
test("type-test harness runs", () => {
	expectTypeOf<string>().toEqualTypeOf<string>();
});
