import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["artifacts/**", "artifacts-safe/**", "cache-safe/**", "cache/**", "cache-foundry/**", "out-foundry/**", "vendor/**", "node_modules/**", "reference/**", "console/dist/**", "playwright-report/**", "test-results/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ["console/ui/**/*.ts", "console/ui/**/*.tsx", "test-ui/**/*.ts", "*.mts", "playwright.config.ts"] })),
  {
    files: ["console/public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["console/**/*.mjs", "scripts/**/*.mjs", "test-data/**/*.mjs", "test-auth/**/*.mjs", "test-native/**/*.mjs", "test-ui/**/*.mjs", "test-rights/**/*.mjs", "test-marketplace/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-control-regex": "off" },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.mocha } },
  },
];
