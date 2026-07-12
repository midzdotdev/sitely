import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Flat config. Non-type-checked `recommended` for now (fast, no project service);
// the import-boundary rule that enforces the package DAG lands with the first
// cross-package import (build ticket #00). `prettier` stays last to switch off
// formatting rules that would fight Prettier. Docs are owned by the docs
// toolchain, so they are excluded here.
export default tseslint.config(
	{
		ignores: ["**/node_modules/**", "**/dist/**", "coverage/**", "docs/**", "planning/**"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.node },
		},
	},
	prettier,
);
