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
        project: "./tsconfig.eslint.json",
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

const tsRules = {
  files: filesTs,
  rules: {
    "no-console": ["error", { allow: ["info", "warn", "error"] }],
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
  }
};

export default tseslint.config(
  jsRecommended,
  ...tsRecommended,
  tsRules
);
