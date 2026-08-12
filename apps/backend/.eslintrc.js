module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.eslint.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
  },
  overrides: [
    {
      // Raw-client bypass prevention (TENANCY.md, ADR-012, Phase 2.13.1):
      // repositories must inject `PrismaContext` (the tenant-scoped,
      // transaction-aware client) so tenant-owned queries can never
      // accidentally skip enforcement. `PrismaLoginOrganizationReader`,
      // `PrismaRestaurantDirectoryReader`, and `PrismaDiscoveryReader` are
      // architecturally justified exceptions - see each file's own doc
      // comment for why its query must run without a bound tenant identity.
      // `PrismaPlatformAdminRestaurantLookupReader` (Phase 19.1, ADR-035
      // Pattern 2) is the Platform Back Office case: same "no single tenant
      // bound yet" justification, but deliberately INCLUDES `organizationId`
      // in its response, unlike the three customer-facing readers above.
      // `PrismaAcquisitionCrossTenantReader` (Phase 19.2, ADR-033/ADR-035)
      // is the second Platform Back Office reader - Revenue Reporting/Export
      // genuinely aggregate across every Restaurant/Organization at once.
      // `PrismaAuditLogReader` (Phase 19.3, ADR-034 §2/ADR-035) is the third -
      // the Audit Log Read API queries across every Organization at once
      // (organizationId is an optional filter, never a required path
      // parameter identifying one target tenant), so no single `organizationId`
      // exists to Pattern-1-rebind to. `PrismaPlatformAdminOrganizationStatsReader`
      // and `PrismaPlatformAdminSubscriptionStatsReader` (Phase 19 — Platform
      // Dashboard composition endpoint) are the fourth/fifth - platform-wide
      // status counts with the identical "no single tenant bound" shape.
      // `PrismaPlatformAdminNotificationStatsReader` (Phase 19.6, closing the
      // Dashboard's disclosed Messaging dependency) is the sixth - same
      // shape again, `Notification` carries no `organizationId` at all
      // (TENANCY.md). `PrismaCustomerAudienceReader` (Phase 19.9, ADR-037)
      // is the seventh - "Customer" (`User` with no `OrganizationMember`/
      // `Employee`/`PlatformAdmin` row, ADR-022) is platform-global, the
      // identical "no single tenant to bind" shape, used to resolve both the
      // Platform Admin and the Restaurant Owner broadcast audience.
      files: ['src/modules/**/infrastructure/persistence/**/*.ts'],
      excludedFiles: [
        '**/prisma-login-organization-reader.ts',
        '**/prisma-restaurant-directory-reader.ts',
        '**/prisma-discovery-reader.ts',
        '**/prisma-platform-admin-restaurant-lookup.reader.ts',
        '**/prisma-acquisition-cross-tenant.reader.ts',
        '**/prisma-audit-log.reader.ts',
        '**/prisma-platform-admin-notification-stats.reader.ts',
        '**/prisma-platform-admin-organization-stats.reader.ts',
        '**/prisma-platform-admin-subscription-stats.reader.ts',
        '**/prisma-customer-audience.reader.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@infrastructure/prisma/prisma.service',
                message:
                  'Tenant-owned repositories must inject PrismaContext (@infrastructure/prisma/prisma-context.service), not the raw PrismaService, so tenant scoping cannot be accidentally bypassed. If this repository genuinely never touches a tenant-owned model and needs the raw client, add it to the ESLint override exclusion in .eslintrc.js with a comment explaining why.',
              },
            ],
          },
        ],
      },
    },
  ],
};
