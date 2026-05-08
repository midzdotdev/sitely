import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@sitely/framework/testing": resolve(__dirname, "packages/framework/src/testing.ts"),
			"@sitely/framework": resolve(__dirname, "packages/framework/src/index.ts"),
			"@sitely/page": resolve(__dirname, "packages/page/src/index.ts"),
			"@sitely/schemas": resolve(__dirname, "packages/schemas/src/index.ts"),
		},
	},
	test: {
		include: ["sites/_validate.test.ts"],
		coverage: {
			provider: "v8",
			include: ["sites/*/index.ts"],
			reporter: ["text", "lcov"],
		},
	},
});
