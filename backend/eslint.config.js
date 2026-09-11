import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,

  /*
   * Invariante de keywords: la marca IgdbKeyword solo puede producirse en
   * src/igdb/keywords.ts (extractIgdbKeywords / brandStoredIgdbKeywords).
   * Cualquier cast `as IgdbKeyword` fuera de src/igdb es un intento
   * deliberado de fabricar procedencia IGDB y debe fallar el lint.
   */
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression[typeAnnotation.typeName.name='IgdbKeyword']",
          message:
            "IgdbKeyword solo se fabrica en src/igdb/keywords.ts. Usa extractIgdbKeywords(raw) o brandStoredIgdbKeywords() (lectura).",
        },
        {
          selector:
            "TSAsExpression TSArrayType > TSTypeReference[typeName.name='IgdbKeyword']",
          message:
            "IgdbKeyword[] solo se fabrica en src/igdb/keywords.ts. Usa extractIgdbKeywords(raw) o brandStoredIgdbKeywords() (lectura).",
        },
      ],
    },
  },
  {
    files: ["src/igdb/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];
