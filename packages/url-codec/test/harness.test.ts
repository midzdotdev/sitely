import { expect, test } from "vitest";

// Canary: proves the vitest runtime harness runs. Delete when real url-codec
// tests land (build ticket #4).
test("runtime harness runs", () => {
	expect(1 + 1).toBe(2);
});
