import { defineConfig } from "vitest/config";

// Single root config discovers every workspace package's tests; pnpm symlinks +
// each package's exports->src mean `@sitely/*` imports resolve to TS source with
// no build step. `pnpm test` runs it with --typecheck so both the runtime and the
// type-test (*.test-d.ts) harnesses execute.
export default defineConfig({
	test: {
		include: ["packages/*/{src,test}/**/*.test.ts"],
		passWithNoTests: true,
		typecheck: {
			include: ["packages/*/{src,test}/**/*.test-d.ts"],
			tsconfig: "./tsconfig.json",
		},
	},
});
