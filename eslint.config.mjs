import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unsafeDomAndEval = [
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message:
      'Do not assign HTML strings; build DOM nodes and use textContent (security_guidelines.md).',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]',
    message: 'Do not inject HTML strings (security_guidelines.md).',
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: 'new Function is forbidden (security_guidelines.md).',
  },
];

export default tseslint.config(
  { ignores: ['dist/', 'out/', 'node_modules/', '.vscode-test/', 'coverage/'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-eval': 'error',
      'no-restricted-syntax': ['error', ...unsafeDomAndEval],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/webview/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'The webview cannot use the VS Code API.' }],
          patterns: [
            {
              group: ['**/extension/**', 'node:*'],
              message: 'Webview code must not import host code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/extension/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/webview/**'], message: 'Host code must not import webview code.' },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
