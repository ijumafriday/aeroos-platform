// Lint rules double as architecture rules: they fail the build when a module reaches into another
// module's internals, or when framework code leaks into the regulated core packages.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const boundary = (patterns, message) => ['error', { patterns: [{ group: patterns, message }] }];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'deploy/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }]
    }
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(
        ['@nestjs/*', 'drizzle-orm*', 'pg', 'kafkajs', '@temporalio/*', 'react', 'react-*', 'fastify*'],
        'Core packages stay framework-free so regulated logic is testable and portable.'
      )
    }
  },
  {
    files: ['apps/api/src/modules/camo/**/*.ts'],
    rules: { 'no-restricted-imports': boundary(['../amo/*', '../org/*', '../ops/*', '**/modules/amo/**', '**/modules/org/**', '**/modules/ops/**'], 'CAMO must not import AMO, Org or Ops internals — react to their events instead.') }
  },
  {
    files: ['apps/api/src/modules/amo/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(['../camo/*', '**/modules/camo/**', '../org/*', '!../org/org.module'],
        'AMO reacts to CAMO events and reads people only through PersonnelQuery exported by org.module.')
    }
  },
  {
    files: ['apps/api/src/modules/ops/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(['../amo/*', '../org/*', '../camo/*', '!../camo/camo.module', '**/modules/amo/**', '**/modules/org/**'],
        'Flight Ops reads airworthiness only through CAMO events and the FleetQuery exported by camo.module.')
    }
  },
  {
    files: ['apps/api/src/modules/org/**/*.ts'],
    rules: { 'no-restricted-imports': boundary(['../camo/*', '../amo/*', '**/modules/camo/**', '**/modules/amo/**'], 'Org Core must not depend on CAMO or AMO — it reacts to their events.') }
  },
  {
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['apps/api/src/modules/org/**'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "ImportDeclaration[source.value=/org\\/org\\.(module|tables)$/] ImportSpecifier[imported.name=/^(personnel|privileges|authorisations|trainingRecords|experienceLog)$/]",
        message: 'Read people through PersonnelQuery, never the org tables.'
      }]
    }
  },
  // AEROOS-LINT-DEBT-BASELINE
  // These files are compiler-valid orchestration/migration surfaces that still carry explicit-any debt.
  // Keep the debt visible as warnings while retaining no-explicit-any as an error everywhere else.
  {
    files: [
      'apps/api/src/modules/**/*.migration.ts',
      'apps/api/src/modules/**/*-control.service.ts',
      'apps/api/src/modules/amo/production.service.ts',
      'apps/api/src/modules/amo/supply-logistics.service.ts',
      'apps/api/src/modules/compliance/master-data.service.ts',
      'apps/api/src/modules/records/records.service.ts',
      'apps/api/src/platform/database/module-db.ts',
      'apps/api/src/platform/rules/rules.service.ts',
      'apps/web/src/components/BarcodeScanButton.tsx',
      'apps/web/src/features/**/*Control.tsx',
      'apps/web/src/features/platform/PlatformConsole.tsx',
      'apps/web/src/features/records/TechnicalRecords.tsx',
      'apps/web/src/features/stores/Logistics.tsx',
      'apps/web/src/features/taskcards/TaskCardDrawer.tsx'
    ],
    rules: { '@typescript-eslint/no-explicit-any': 'warn' }
  },
  // Runtime-specific JavaScript globals. These are not browser-window scripts.
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { self: 'readonly', caches: 'readonly', URL: 'readonly', fetch: 'readonly', Promise: 'readonly' } }
  },
  {
    files: ['e2e/docker/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } }
  },
  {
    files: ['tests/load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly' } }
  }
);
