/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
    ecmaVersion: "latest",
    project: undefined
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  rules: {
    "no-console": "off",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "off"
  },
  overrides: [
    {
      files: ["tests/**/*.ts", "test/**/*.ts"],
      env: {
        "vitest/globals": true
      },
      plugins: ["vitest"],
      extends: ["plugin:vitest/recommended"]
    }
  ]
};

