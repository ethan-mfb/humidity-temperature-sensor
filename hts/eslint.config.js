import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// The clean architecture dependency rule: source code dependencies only point
// inwards. Each layer lists the outer layers it must not import.
const layerImportRule = (forbiddenLayers) => [
  "error",
  {
    patterns: [
      {
        regex: `(^|/)(${forbiddenLayers.join("|")})(/|$)`,
        message:
          "Clean architecture: inner layers must not depend on outer layers. See README.md.",
      },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dev-dist",
      "node_modules",
      "e2e/.builds",
      "test-results",
      "playwright-report",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration, ClassExpression",
          message: "Use factory functions, not classes.",
        },
        {
          selector: "TSEnumDeclaration",
          message: "Use constants and string literal types, not enums.",
        },
      ],
    },
  },
  {
    files: ["src/domain/**"],
    rules: {
      "no-restricted-imports": layerImportRule([
        "application",
        "adapters",
        "infrastructure",
        "react",
      ]),
    },
  },
  {
    files: ["src/application/**"],
    rules: {
      "no-restricted-imports": layerImportRule([
        "adapters",
        "infrastructure",
        "react",
      ]),
    },
  },
  {
    files: ["src/adapters/**"],
    rules: {
      "no-restricted-imports": layerImportRule(["infrastructure"]),
    },
  },
);
