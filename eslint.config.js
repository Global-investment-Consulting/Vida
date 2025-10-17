import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

const filesTs = [
  "peppol/**/*.ts",
  "src/**/*.ts",
  "tests/**/*.ts"
];

const filesJs = [
  "scripts/peppol-generate.mjs",
  "eslint.config.js"
];

const tsRecommended = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: filesTs,
  languageOptions: {
    sourceType: "module",
    globals: globals.node,
    parser: tseslint.parser,
    parserOptions: {
      ...(config.languageOptions?.parserOptions ?? {}),
      project: "./tsconfig.json",
      tsconfigRootDir: process.cwd()
    }
  }
}));

const jsRecommended = {
  ...js.configs.recommended,
  files: filesJs,
  languageOptions: {
    sourceType: "module",
    globals: globals.node
  }
};

export default tseslint.config(
  jsRecommended,
  ...tsRecommended
);
