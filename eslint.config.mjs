import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "dist/**",
      "output/**",
      "public/ocr/**",
      "tmp/**",
      "node_modules/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["api/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
