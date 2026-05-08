import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@wapi/framework/testing": resolve(__dirname, "packages/framework/src/testing.ts"),
			"@wapi/framework": resolve(__dirname, "packages/framework/src/index.ts"),
			"@wapi/page": resolve(__dirname, "packages/page/src/index.ts"),
			"@wapi/schemas": resolve(__dirname, "packages/schemas/src/index.ts"),
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
