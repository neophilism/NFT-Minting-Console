import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["artifacts/**", "artifacts-safe/**", "cache-safe/**", "cache/**", "cache-foundry/**", "out-foundry/**", "vendor/**", "node_modules/**", "reference/**"],
  },
  js.configs.recommended,
  {
    files: ["console/public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["console/**/*.mjs", "scripts/**/*.mjs", "test-data/**/*.mjs", "test-auth/**/*.mjs", "test-native/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-control-regex": "off" },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.mocha } },
  },
];
