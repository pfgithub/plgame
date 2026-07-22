// eslint.config.js
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import js from "@eslint/js";

export default defineConfig([
    stylistic.configs.customize({
        indent: 4,
        semi: true,
        jsx: true,
        quotes: "double",
        braceStyle: "1tbs",
        blockSpacing: false,
    }),
    js.configs.recommended,
    tseslint.configs.recommended,
    // tseslint.configs.recommendedTypeChecked,
    {
        plugins: {
            "@stylistic": stylistic,
        },
        rules: {
            "@stylistic/object-curly-spacing": ["error", "never", {
                overrides: {
                    ImportDeclaration: "always",
                },
            }],
            "@stylistic/member-delimiter-style": ["error", {
                multiline: {
                    delimiter: "comma",
                    requireLast: true,
                },
                singleline: {
                    delimiter: "comma",
                    requireLast: false,
                },
                multilineDetection: "last-member",
            }],
            "@stylistic/semi": ["error", "always", {omitLastInOneLineBlock: true, omitLastInOneLineClassBody: true}], // TODO: need to add a 'multilineDetection: last-member' option for this rule
            "@stylistic/multiline-ternary": ["off"],
            "@stylistic/quotes": ["error", "double", {allowTemplateLiterals: "never", avoidEscape: false}],
            "prefer-template": ["error"],
            "no-undef": ["off"],
            "no-unused-vars": ["off"],
            "@typescript-eslint/no-unused-vars": ["off"],
            "@typescript-eslint/no-explicit-any": ["off"],
            "@typescript-eslint/no-empty-object-type": ["off"], // eeh whatever. these are generally temporary and get filled in later.
        },
        extends: [tseslint.configs.base],
        files: ["eslint.config.ts", "src/**/*.{,m,c}{j,t}s{,x}"],
        languageOptions: {
            parserOptions: {
                projectService: true,
            },
        },
    },
]);
