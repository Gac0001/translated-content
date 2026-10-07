// Analyse statique du frontend : erreurs bloquantes pour les vrais défauts (variables inconnues,
// règles des hooks, clés de liste), avertissements pour l’accessibilité et l’hygiène du code.
// Lancement : npm run lint
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'e2e/captures/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...Object.fromEntries(Object.keys(jsxA11y.configs.recommended.rules).map((r) => [r, 'warn'])),
      'jsx-a11y/no-autofocus': 'off',
      // Le composant Field relie libellé et champ à l’exécution (cloneElement) : invisible à l’analyse statique.
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/label-has-for': 'off', // règle obsolète, remplacée par label-has-associated-control
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['e2e/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } }, // page.evaluate s’exécute dans le navigateur
  },
];
