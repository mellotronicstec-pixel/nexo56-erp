import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescriptConfig from 'eslint-config-next/typescript';

/**
 * Configuracao flat do ESLint (Prompt 01, item 101).
 * Usa os presets nativos do eslint-config-next 16 — sem FlatCompat.
 */
const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts', 'coverage/**'],
  },
  ...coreWebVitals,
  ...typescriptConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    // Scripts CLI e o proprio logger escrevem em stdout por design.
    files: ['scripts/**/*.ts', 'src/core/logging/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];

export default eslintConfig;
