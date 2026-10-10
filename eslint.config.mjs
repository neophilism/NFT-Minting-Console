import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["artifacts/**", "cache/**", "node_modules/**", "reference/**"],
  },
  js.configs.recommended,
  {
    files: ["console/public/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ethers: "readonly" } },
  },
  {
    files: ["console/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-control-regex": "off" },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.mocha } },
  },
];
