const js = require("@eslint/js");
const typescript = require("@typescript-eslint/eslint-plugin");
const typescriptParser = require("@typescript-eslint/parser");

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        // Jest globals
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        // Express globals
        Express: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off", // Disable any type warnings
      "@typescript-eslint/explicit-function-return-type": "off", // Disable return type warnings
      "prefer-const": "error",
      "no-var": "error",
      "no-console": "off", // Allow console.log in Node.js
      "@typescript-eslint/no-require-imports": "off", // Allow require() in Node.js
      "@typescript-eslint/no-var-requires": "off", // Allow require() in Node.js
      "no-unreachable": "off", // Disable unreachable code warnings
      "no-useless-catch": "off", // Disable useless catch wrapper warnings
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "*.js",
      "*.d.ts",
    ],
  },
];
