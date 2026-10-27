import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [
  { ignores: ['**/dist/**', 'coverage/**', '.artifacts/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parser },
    plugins: { '@typescript-eslint': plugin },
    rules: { ...plugin.configs['eslint-recommended'].overrides[0].rules, ...plugin.configs.recommended.rules },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly', Headers: 'readonly', Response: 'readonly', ReadableStream: 'readonly', AbortSignal: 'readonly', AbortController: 'readonly' } },
  },
];
