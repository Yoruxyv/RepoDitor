import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const rendererEntryPoint = fileURLToPath(new URL("./src/index.css", import.meta.url));
const rendererTsconfig = fileURLToPath(new URL("./tsconfig.app.json", import.meta.url));
// Resource lifecycle handlers such as onLoad/onError are not user interactions.
const interactionHandlers = [
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onKeyPress",
  "onKeyDown",
  "onKeyUp",
];

export default defineConfig([
  globalIgnores([
    ".vite-cache",
    "build",
    "coverage",
    "dist",
    "dist-electron",
    "node_modules",
    "playwright-report",
    "python/",
    "test-results",
    "src-tauri/target",
    "src-tauri/gen",
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },
  {
    files: ["**/*.{ts,tsx,cts,mts}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: {
          allowDefaultProject: ["playwright.config.ts"],
        },
        tsconfigRootDir: configDirectory,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      sonarjs,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...sonarjs.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "prefer-object-has-own": "error",
      "no-nested-ternary": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "sonarjs/cognitive-complexity": ["warn", 15],
      "sonarjs/no-identical-expressions": "warn",
      "sonarjs/no-nested-conditional": "warn",
      "sonarjs/prefer-read-only-props": "warn",
      "sonarjs/no-selector-parameter": "warn",
      "sonarjs/prefer-regexp-exec": "warn",
      "sonarjs/void-use": "error",
      "sonarjs/no-duplicate-string": ["warn", { threshold: 2 }],
    },
  },
  {
    files: ["electron/**/*.cts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.electron.json",
        projectService: false,
        tsconfigRootDir: configDirectory,
      },
    },
  },
  {
    files: ["electron/**/*.test.ts"],
    languageOptions: {
      parserOptions: {
        project: "./electron/tsconfig.json",
        projectService: false,
        tsconfigRootDir: configDirectory,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "installer/ui/src/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.vite.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/jsx-child-element-spacing": "warn",
      "react/jsx-no-constructed-context-values": "warn",
      "react/hook-use-state": "warn",
      "jsx-a11y/prefer-tag-over-role": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": [
        "error",
        {
          handlers: interactionHandlers,
        },
      ],

      "jsx-a11y/no-static-element-interactions": [
        "error",
        {
          handlers: interactionHandlers,
          allowExpressionValues: true,
        },
      ],
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/aria-role": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./",
              message: "Use a renderer alias instead of importing from a parent directory.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        entryPoint: rendererEntryPoint,
        tsconfig: rendererTsconfig,
        messageStyle: "compact",
      },
    },
    rules: {
      "better-tailwindcss/enforce-canonical-classes": "error",
    },
  },
  {
    // Repeated fixture/assertion text and independent translation copy are intentionally local.
    files: [
      "**/*.test.{ts,tsx}",
      "e2e/**/*.{ts,tsx}",
      "src/test/**/*.{ts,tsx}",
      "src/app/i18n/locales/**/*.{ts,tsx}",
    ],
    rules: {
      "sonarjs/no-duplicate-string": "off",
    },
  },
  eslintConfigPrettier,
]);
