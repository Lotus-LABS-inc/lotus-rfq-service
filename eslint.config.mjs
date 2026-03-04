import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: ["dist/**", "node_modules/**", ".cache/**", "coverage/**"]
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error"
    },
    rules: {}
  }
];
