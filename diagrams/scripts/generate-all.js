/**
 * Data definitions for all TAVLA phase-2 diagrams.
 * Usage: node diagrams/scripts/generate-all.js
 */
const { COLOR, boxStyle, buildSequence, buildLayered, buildER } = require('./build-diagrams');

const CALL_LEGEND = [
  { style: 'html=1;endArrow=block;endFill=1;strokeColor=#37474f;', label: 'Synchronous call', line: true },
  {
    style: 'rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#90a4ae;dashed=1;',
    label: 'Conditional / alt branch',
  },
];

const DEP_LEGEND = [
  { style: boxStyle(COLOR.presentation), label: 'Presentation layer' },
  { style: boxStyle(COLOR.application), label: 'Application layer' },
  { style: boxStyle(COLOR.domain), label: 'Domain layer' },
  { style: boxStyle(COLOR.infrastructure), label: 'Infrastructure layer' },
  {
    style: 'html=1;endArrow=block;endFill=1;strokeColor=#607d8b;',
    label: 'depends on / calls',
    line: true,
  },
  {
    style: 'html=1;endArrow=block;endFill=0;dashed=1;strokeColor=#607d8b;',
    label: 'implements (realization)',
    line: true,
  },
];

// ===========================================================================
// 1. phase-2-0-1-auth-authz-modules
// ===========================================================================
function buildAuthAuthzModules() {
  const lanes = [
    {
      name: '"authentication module"',
      color: COLOR.auth,
      items: [
        { key: 'jwtGuard', label: 'JwtAuthGuard', color: COLOR.guard },
        { key: 'sessionGuard', label: 'SessionVersionGuard', color: COLOR.guard },
        { key: 'loginEndpoints', label: 'Login / Refresh / Logout', color: COLOR.presentation },
      ],
    },
    {
      name: '"authorization module"',
      color: COLOR.rbac,
      items: [
        { key: 'permGuard', label: 'PermissionsGuard / Scope Guards', color: COLOR.guard },
        { key: 'policyEngine', label: 'PolicyEngine', color: COLOR.application },
        { key: 'permResolver', label: 'PermissionResolver', color: COLOR.application },
        { key: 'domainPolicies', label: 'Domain Policies', color: COLOR.domain },
      ],
    },
    {
      name: '"infrastructure/tenancy"',
      color: COLOR.infrastructure,
      items: [{ key: 'prismaOrgId', label: 'Prisma orgId extension', color: COLOR.infrastructure }],
    },
  ];
  const edges = [
    { from: 'jwtGuard', to: 'sessionGuard' },
    { from: 'sessionGuard', to: 'permGuard' },
    { from: 'permGuard', to: 'policyEngine' },
    { from: 'policyEngine', to: 'permResolver' },
    { from: 'policyEngine', to: 'domainPolicies' },
    { from: 'permGuard', to: 'prismaOrgId' },
  ];
  const legendEntries = [
    { style: boxStyle(COLOR.guard), label: 'Guard (request-level enforcement)' },
    { style: boxStyle(COLOR.application), label: 'Application service' },
    { style: boxStyle(COLOR.domain), label: 'Domain policy' },
    { style: boxStyle(COLOR.presentation), label: 'Presentation (controller/endpoints)' },
    { style: boxStyle(COLOR.infrastructure), label: 'Infrastructure' },
  ];
  buildLayered(
    'phase-2-0-1-auth-authz-modules',
    'Phase 2.0/2.1 — Authentication & Authorization Module Map',
    lanes,
    edges,
    legendEntries,
  );
}

// ===========================================================================
// 2. phase-2-2-domain-layer
// ===========================================================================
function buildDomainLayer() {
  const container = { fill: '#fafafa', stroke: '#9e9e9e' };
  const lanes = [
    {
      name: '"shared/domain"',
      color: container,
      items: [
        { key: 'sharedVO', label: 'Value Objects', color: COLOR.domain },
        { key: 'sharedBases', label: 'Entity / ValueObject / DomainEvent bases', color: COLOR.domain },
        { key: 'sharedExc', label: 'DomainException base', color: COLOR.domain },
      ],
    },
    {
      name: '"authentication/domain"',
      color: container,
      items: [
        { key: 'authEntities', label: 'User / DeviceSession / TokenFamily', color: COLOR.domain },
        {
          key: 'authPolicies',
          label: 'Session / Login / TokenFamily / Authentication Policies',
          color: COLOR.domain,
        },
        { key: 'authPorts', label: 'Repository ports', color: COLOR.domain, interface: true },
        { key: 'authEvents', label: 'Auth events & exceptions', color: COLOR.domain },
      ],
    },
    {
      name: '"organizations/domain"',
      color: container,
      items: [
        { key: 'orgEntities', label: 'Organization / OrganizationMember', color: COLOR.domain },
        { key: 'orgPolicy', label: 'OrganizationMembershipPolicy', color: COLOR.domain },
        { key: 'orgPorts', label: 'Repository ports', color: COLOR.domain, interface: true },
        { key: 'orgExc', label: 'Org exceptions', color: COLOR.domain },
      ],
    },
    {
      name: '"authorization/domain"',
      color: container,
      items: [
        { key: 'authzEntities', label: 'Role / Permission / RolePermission / Employee', color: COLOR.domain },
        { key: 'authzResolver', label: 'PermissionResolver', color: COLOR.domain },
        { key: 'authzPolicy', label: 'AuthorizationPolicy', color: COLOR.domain },
        { key: 'authzPorts', label: 'Repository ports', color: COLOR.domain, interface: true },
        { key: 'authzEvents', label: 'Authz events & exceptions', color: COLOR.domain },
      ],
    },
  ];
  const edges = [
    { from: 'sharedVO', to: 'authEntities' },
    { from: 'sharedVO', to: 'orgEntities' },
    { from: 'sharedVO', to: 'authzEntities' },
    { from: 'sharedBases', to: 'authEntities' },
    { from: 'sharedBases', to: 'orgEntities' },
    { from: 'sharedBases', to: 'authzEntities' },
    { from: 'sharedExc', to: 'authEvents' },
    { from: 'sharedExc', to: 'orgExc' },
    { from: 'sharedExc', to: 'authzEvents' },
    { from: 'sharedVO', to: 'authzResolver' },
    { from: 'authzEntities', to: 'authzResolver' },
    { from: 'authzEntities', to: 'authzPolicy' },
    { from: 'authzResolver', to: 'authzPolicy' },
  ];
  const legendEntries = [
    { style: boxStyle(COLOR.domain), label: 'Domain building block (entity, VO, policy, event)' },
    { style: boxStyle(COLOR.domain, 'dashed=1;'), label: 'Repository port (interface)' },
  ];
  buildLayered(
    'phase-2-2-domain-layer',
    'Phase 2.2 — Domain Layer (bounded contexts)',
    lanes,
    edges,
    legendEntries,
  );
}

// ===========================================================================
// 3. phase-2-1-database-er  (rebuilt from apps/backend/prisma/schema.prisma)
// ===========================================================================
function f(name, type, flags = {}) {
  return { name, type, ...flags };
}

function buildDatabaseEr() {
  const groups = [
    {
      name: 'Identity & Tenancy',
      color: COLOR.identity,
      entities: [
        {
          name: 'Organization',
          fields: [
            f('id', 'uuid', { pk: true }),
            f('name', 'string'),
            f('slug', 'string'),
            f('status', 'enum'),
            f('billingEmail', 'string'),
          ],
          footer: '+ createdAt, updatedAt, deletedAt',
        },
        {
          name: 'OrganizationMember',
          fields: [
            f('id', 'uuid', { pk: true }),
            f('organizationId', 'uuid', { fk: true }),
            f('userId', 'uuid', { fk: true }),
            f('role', 'enum'),
            f('status', 'enum'),
            f('invitedAt / joinedAt', 'timestamp'),
          ],
          footer: '+ createdAt, updatedAt',
          note: 'UK (organizationId, userId)',
        },
        {
          name: 'User',
          fields: [
            f('id', 'uuid', { pk: true }),
            f('firstName, lastName', 'string'),
            f('email', 'string', { uk: true }),
            f('phone', 'string?'),
            f('passwordHash', 'string'),
            f('status', 'enum'),
            f('emailVerified', 'bool'),
            f('failedLoginCount', 'int'),
            f('lockedUntil', 'timestamp?'),
            f('permissionsVersion', 'int'),
            f('sessionVersion', 'int'),
            f('lastLoginAt', 'timestamp?'),
          ],
          footer: '+ createdAt, updatedAt, deletedAt',
        },
      ],
    },
    {
      name: 'Authentication',
      color: COLOR.auth,
      entities: [
        {
          name: 'TokenFamily',
          fields: [f('id', 'uuid', { pk: true }), f('userId', 'uuid', { fk: true }), f('compromisedAt', 'timestamp?'), f('revokedAt', 'timestamp?')],
          footer: '+ createdAt',
        },
        {
          name: 'DeviceSession',
          fields: [
            f('id', 'uuid', { pk: true }),
            f('userId', 'uuid', { fk: true }),
            f('tokenFamilyId', 'uuid', { fk: true }),
            f('refreshTokenHash', 'string', { uk: true }),
            f('deviceType', 'enum'),
            f('sessionVersion', 'int'),
            f('permissionsVersion', 'int'),
            f('revokedAt / revokedReason', 'timestamp?/enum?'),
            f('expiresAt', 'timestamp'),
          ],
          footer: '+ createdAt',
        },
        {
          name: 'EmailVerificationToken',
          fields: [f('id', 'uuid', { pk: true }), f('userId', 'uuid', { fk: true }), f('tokenHash', 'string', { uk: true }), f('expiresAt', 'timestamp'), f('consumedAt', 'timestamp?')],
          footer: '+ createdAt',
        },
        {
          name: 'PasswordResetToken',
          fields: [f('id', 'uuid', { pk: true }), f('userId', 'uuid', { fk: true }), f('tokenHash', 'string', { uk: true }), f('expiresAt', 'timestamp'), f('consumedAt', 'timestamp?')],
          footer: '+ createdAt',
        },
        {
          name: 'PasswordHistory',
          fields: [f('id', 'uuid', { pk: true }), f('userId', 'uuid', { fk: true }), f('passwordHash', 'string')],
          footer: '+ createdAt',
        },
        {
          name: 'LoginAttempt',
          fields: [f('id', 'uuid', { pk: true }), f('identifier', 'string'), f('ipAddress', 'string'), f('success', 'bool'), f('failureReason', 'string?')],
          footer: '+ createdAt',
          note: 'standalone — no FK',
        },
        {
          name: 'PlatformAdmin',
          fields: [f('id', 'uuid', { pk: true }), f('userId', 'uuid', { fk: true, uk: true }), f('revokedAt', 'timestamp?')],
          footer: '+ createdAt',
        },
      ],
    },
    {
      name: 'Authorization (RBAC)',
      color: COLOR.rbac,
      entities: [
        {
          name: 'Role',
          fields: [f('id', 'uuid', { pk: true }), f('name', 'string', { uk: true }), f('slug', 'string', { uk: true }), f('description', 'string'), f('scope', 'enum')],
          footer: '+ createdAt, updatedAt',
        },
        {
          name: 'Permission',
          fields: [f('id', 'uuid', { pk: true }), f('slug', 'string', { uk: true }), f('description', 'string')],
          footer: '+ createdAt',
        },
        {
          name: 'RolePermission',
          fields: [
            f('id', 'uuid', { pk: true }),
            f('roleId', 'uuid?', { fk: true }),
            f('employeeId', 'uuid?', { fk: true }),
            f('permissionId', 'uuid', { fk: true }),
            f('type', 'enum'),
          ],
          footer: '+ createdAt',
        },
        {
          name: 'Employee',
          fields: [
            f('id', 'uuid', { pk: true }),
            f('restaurantId', 'uuid', { fk: true }),
            f('roleId', 'uuid', { fk: true }),
            f('userId', 'uuid?', { fk: true }),
            f('permissionsVersion', 'int'),
            f('firstName, lastName', 'string'),
            f('email', 'string'),
            f('status', 'string'),
          ],
          footer: '+ createdAt, updatedAt, deletedAt',
        },
        {
          name: 'EmployeeBranchAssignment',
          fields: [f('id', 'uuid', { pk: true }), f('employeeId', 'uuid', { fk: true }), f('branchId', 'uuid', { fk: true }), f('assignedAt', 'timestamp')],
          footer: '+ createdAt',
          note: 'UK (employeeId, branchId)',
        },
      ],
    },
    {
      name: 'Restaurant Structure (foundation)',
      color: COLOR.restaurant,
      entities: [
        {
          name: 'Restaurant',
          fields: [f('id', 'uuid', { pk: true }), f('organizationId', 'uuid', { fk: true }), f('name', 'string'), f('slug', 'string'), f('status', 'string')],
          footer: '+ createdAt, updatedAt, deletedAt',
        },
        {
          name: 'Branch',
          fields: [
            f('id', 'uuid', { pk: true }),
            f('restaurantId', 'uuid', { fk: true }),
            f('city', 'string'),
            f('countryCode', 'string'),
            f('currency', 'string?'),
            f('timezone', 'string'),
          ],
          footer: '+ createdAt, updatedAt, deletedAt',
        },
      ],
    },
    {
      name: 'Platform Configuration',
      color: COLOR.platform,
      entities: [
        {
          name: 'SystemConfiguration',
          fields: [f('id', 'uuid', { pk: true }), f('key', 'string', { uk: true }), f('value', 'jsonb'), f('description', 'string?'), f('updatedBy', 'string?')],
          footer: '+ updatedAt',
          note: 'standalone — no FK',
        },
      ],
    },
  ];

  const relationships = [
    { from: 'Organization', to: 'OrganizationMember', label: 'has' },
    { from: 'User', to: 'OrganizationMember', label: 'holds' },
    { from: 'User', to: 'TokenFamily', label: 'owns' },
    { from: 'User', to: 'DeviceSession', label: 'owns' },
    { from: 'TokenFamily', to: 'DeviceSession', label: 'groups' },
    { from: 'User', to: 'EmailVerificationToken', label: 'requests' },
    { from: 'User', to: 'PasswordResetToken', label: 'requests' },
    { from: 'User', to: 'PasswordHistory', label: 'has' },
    { from: 'User', to: 'PlatformAdmin', kind: 'one-to-one', label: 'is' },
    { from: 'Organization', to: 'Restaurant', label: 'owns' },
    { from: 'Restaurant', to: 'Branch', label: 'has' },
    { from: 'Role', to: 'RolePermission', label: 'grants' },
    { from: 'Employee', to: 'RolePermission', label: 'overrides' },
    { from: 'Permission', to: 'RolePermission', label: 'included in' },
    { from: 'Restaurant', to: 'Employee', label: 'employs' },
    { from: 'Role', to: 'Employee', label: 'assigned to' },
    { from: 'User', to: 'Employee', label: 'linked to' },
    { from: 'Employee', to: 'EmployeeBranchAssignment', label: 'scoped to' },
    { from: 'Branch', to: 'EmployeeBranchAssignment', label: 'scoped by' },
  ];

  const legendEntries = [
    { style: boxStyle(COLOR.identity), label: 'Identity & Tenancy' },
    { style: boxStyle(COLOR.auth), label: 'Authentication' },
    { style: boxStyle(COLOR.rbac), label: 'Authorization (RBAC)' },
    { style: boxStyle(COLOR.restaurant), label: 'Restaurant structure' },
    { style: boxStyle(COLOR.platform), label: 'Platform configuration' },
    {
      style: 'edgeStyle=entityRelationEdgeStyle;html=1;startArrow=ERone;startFill=0;endArrow=ERmany;endFill=0;strokeColor=#546e7a;',
      label: 'one-to-many (PK → FK)',
      line: true,
    },
  ];

  buildER(
    'phase-2-1-database-er',
    'Phase 2.1 — Database Foundation ER Diagram (19 Prisma models)',
    groups,
    relationships,
    legendEntries,
  );
}

// ===========================================================================
// Shared sequence-diagram participant color
// ===========================================================================
const SEQ = {
  actor: COLOR.actor,
  presentation: COLOR.presentation,
  application: COLOR.application,
  domain: COLOR.domain,
  infrastructure: COLOR.infrastructure,
};

// ===========================================================================
// 4/5. phase-2-5-register-organization-owner
// ===========================================================================
function buildRegisterOwner() {
  // --- sequence ---
  const participants = [
    { key: 'uc', label: 'RegisterOrganizationOwnerUseCase', color: SEQ.application },
    { key: 'userRepo', label: 'UserRepository', color: SEQ.domain },
    { key: 'orgRepo', label: 'OrganizationRepository', color: SEQ.domain },
    { key: 'memberRepo', label: 'OrganizationMemberRepository', color: SEQ.domain },
    { key: 'pwHasher', label: 'PasswordHasher', color: SEQ.domain },
    { key: 'sysConfig', label: 'SystemConfigurationPort', color: SEQ.application },
    { key: 'tokenSvc', label: 'OpaqueTokenService', color: SEQ.domain },
    { key: 'uow', label: 'UnitOfWorkPort', color: SEQ.application },
    { key: 'verifyRepo', label: 'EmailVerificationRepository', color: SEQ.domain },
    { key: 'consentRepo', label: 'UserConsentRepository', color: SEQ.domain },
    { key: 'events', label: 'EventPublisherPort', color: SEQ.application },
  ];
  const steps = [
    { type: 'self', on: 'uc', label: 'validateCommand(command)' },
    { type: 'message', from: 'uc', to: 'userRepo', label: 'existsByEmail(email)' },
    { type: 'alt', label: 'email already registered', body: [{ type: 'self', on: 'uc', label: 'throw EmailAlreadyExistsException' }] },
    { type: 'message', from: 'uc', to: 'orgRepo', label: 'findBySlug(slug)' },
    { type: 'alt', label: 'slug already taken', body: [{ type: 'self', on: 'uc', label: 'throw OrganizationSlugAlreadyExistsException' }] },
    { type: 'message', from: 'uc', to: 'pwHasher', label: 'hash(password)' },
    { type: 'message', from: 'uc', to: 'sysConfig', label: 'getString(termsOfServiceVersion)' },
    { type: 'message', from: 'uc', to: 'sysConfig', label: 'getString(privacyPolicyVersion)' },
    { type: 'message', from: 'uc', to: 'sysConfig', label: 'getNumber(emailVerificationTokenTtlHours)' },
    { type: 'message', from: 'uc', to: 'tokenSvc', label: 'generate()' },
    { type: 'message', from: 'uc', to: 'tokenSvc', label: 'hash(token)' },
    { type: 'message', from: 'uc', to: 'uow', label: 'execute(transaction)' },
    { type: 'message', from: 'uow', to: 'userRepo', label: 'save(user)' },
    { type: 'message', from: 'uow', to: 'orgRepo', label: 'save(organization)' },
    { type: 'message', from: 'uow', to: 'memberRepo', label: 'save(ownerMembership)' },
    { type: 'message', from: 'uow', to: 'consentRepo', label: 'saveMany(consents)' },
    { type: 'message', from: 'uow', to: 'verifyRepo', label: 'invalidateActiveByUserId(userId)' },
    { type: 'message', from: 'uow', to: 'verifyRepo', label: 'save(verificationToken)' },
    { type: 'message', from: 'uc', to: 'events', label: 'publish(UserRegisteredEvent)' },
  ];
  buildSequence(
    'phase-2-5-register-owner-sequence',
    'Phase 2.5 — RegisterOrganizationOwnerUseCase.execute()',
    participants,
    steps,
    CALL_LEGEND,
  );

  // --- dependency graph ---
  const lanes = [
    {
      name: 'Application',
      color: COLOR.application,
      items: [
        { key: 'uc', label: 'RegisterOrganizationOwnerUseCase' },
        { key: 'command', label: 'RegisterOrganizationOwnerCommand' },
        { key: 'result', label: 'RegisterOrganizationOwnerResult' },
        { key: 'sysConfigPort', label: 'SystemConfigurationPort' },
        { key: 'appExc', label: 'Application Exceptions (Consent / InvalidInput)' },
      ],
    },
    {
      name: 'Domain',
      color: COLOR.domain,
      items: [
        { key: 'userEntity', label: 'User / RegistrationPolicy' },
        { key: 'orgEntity', label: 'Organization / OrganizationRegistrationPolicy' },
        { key: 'memberEntity', label: 'OrganizationMember / OrganizationMembershipPolicy' },
        { key: 'consentEntity', label: 'UserConsent entity' },
        { key: 'event', label: 'UserRegisteredEvent' },
        { key: 'domainExc', label: 'EmailAlreadyExists / SlugAlreadyExists exceptions' },
        { key: 'userRepoPort', label: 'UserRepository Port', interface: true },
        { key: 'orgRepoPort', label: 'OrganizationRepository Port', interface: true },
        { key: 'memberRepoPort', label: 'OrganizationMemberRepository Port', interface: true },
        { key: 'verifyRepoPort', label: 'EmailVerificationRepository Port', interface: true },
        { key: 'consentRepoPort', label: 'UserConsentRepository Port', interface: true },
        { key: 'pwHasherPort', label: 'PasswordHasher Port', interface: true },
        { key: 'tokenSvcPort', label: 'OpaqueTokenService Port', interface: true },
      ],
    },
    {
      name: 'Infrastructure',
      color: COLOR.infrastructure,
      items: [
        { key: 'prismaUserRepo', label: 'PrismaUserRepository' },
        { key: 'prismaVerifyRepo', label: 'PrismaEmailVerificationRepository' },
        { key: 'argon2', label: 'Argon2PasswordHasher' },
        { key: 'sha256', label: 'Sha256OpaqueTokenService' },
        { key: 'prismaUow', label: 'PrismaUnitOfWork' },
        { key: 'loggingPublisher', label: 'LoggingEventPublisher' },
        { key: 'systemClock', label: 'SystemClock' },
        { key: 'uuidGen', label: 'UuidIdGenerator' },
        { key: 'prismaSysConfig', label: 'PrismaSystemConfiguration' },
        { key: 'prismaOrgRepo', label: 'PrismaOrganizationRepository', pending: true },
        { key: 'prismaMemberRepo', label: 'PrismaOrganizationMemberRepository', pending: true },
        { key: 'prismaConsentRepo', label: 'PrismaUserConsentRepository', pending: true },
      ],
    },
  ];
  const edges = [
    { from: 'uc', to: 'command' },
    { from: 'uc', to: 'result' },
    { from: 'uc', to: 'appExc' },
    { from: 'uc', to: 'sysConfigPort' },
    { from: 'uc', to: 'userEntity' },
    { from: 'uc', to: 'orgEntity' },
    { from: 'uc', to: 'memberEntity' },
    { from: 'uc', to: 'consentEntity' },
    { from: 'uc', to: 'event' },
    { from: 'uc', to: 'domainExc' },
    { from: 'uc', to: 'userRepoPort' },
    { from: 'uc', to: 'orgRepoPort' },
    { from: 'uc', to: 'memberRepoPort' },
    { from: 'uc', to: 'verifyRepoPort' },
    { from: 'uc', to: 'consentRepoPort' },
    { from: 'uc', to: 'pwHasherPort' },
    { from: 'uc', to: 'tokenSvcPort' },
    { from: 'uc', to: 'prismaUow' },
    { from: 'uc', to: 'systemClock' },
    { from: 'uc', to: 'uuidGen' },
    { from: 'uc', to: 'loggingPublisher' },
    { from: 'prismaUserRepo', to: 'userRepoPort', dashed: true },
    { from: 'prismaVerifyRepo', to: 'verifyRepoPort', dashed: true },
    { from: 'argon2', to: 'pwHasherPort', dashed: true },
    { from: 'sha256', to: 'tokenSvcPort', dashed: true },
    { from: 'prismaSysConfig', to: 'sysConfigPort', dashed: true },
    { from: 'prismaOrgRepo', to: 'orgRepoPort', dashed: true },
    { from: 'prismaMemberRepo', to: 'memberRepoPort', dashed: true },
    { from: 'prismaConsentRepo', to: 'consentRepoPort', dashed: true },
  ];
  const legendEntries = DEP_LEGEND.concat([
    { style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8f9fa;strokeColor=#b3b3b3;dashed=1;', label: 'Not yet implemented (Phase 2.19)' },
  ]);
  buildLayered(
    'phase-2-5-register-owner-dependency-graph',
    'Phase 2.5 — RegisterOrganizationOwnerUseCase Dependencies (application layer only — no HTTP endpoint wired yet)',
    lanes,
    edges,
    legendEntries,
  );
}

// ===========================================================================
// 6/7. phase-2-6-verify-email
// ===========================================================================
function buildVerifyEmail() {
  const participants = [
    { key: 'client', label: 'Client', color: SEQ.actor },
    { key: 'controller', label: 'AuthController', color: SEQ.presentation },
    { key: 'uc', label: 'VerifyEmailUseCase', color: SEQ.application },
    { key: 'tokenSvc', label: 'OpaqueTokenService', color: SEQ.domain },
    { key: 'verifyRepo', label: 'EmailVerificationRepo', color: SEQ.domain },
    { key: 'userRepo', label: 'UserRepo', color: SEQ.domain },
    { key: 'policy', label: 'EmailVerificationPolicy', color: SEQ.domain },
    { key: 'uow', label: 'UnitOfWork', color: SEQ.application },
    { key: 'events', label: 'EventPublisher', color: SEQ.application },
  ];
  const steps = [
    { type: 'message', from: 'client', to: 'controller', label: 'POST /api/v1/auth/verify-email { token }' },
    { type: 'message', from: 'controller', to: 'uc', label: 'execute({ token })' },
    { type: 'message', from: 'uc', to: 'tokenSvc', label: 'hash(token)' },
    { type: 'message', from: 'uc', to: 'verifyRepo', label: 'findByTokenHash(hash)' },
    { type: 'alt', label: 'token not found', body: [{ type: 'self', on: 'uc', label: 'throw (token not found)' }] },
    { type: 'message', from: 'uc', to: 'tokenSvc', label: 'verify(token, storedHash)' },
    { type: 'message', from: 'uc', to: 'policy', label: 'resolveTokenState(record, now)' },
    { type: 'alt', label: 'expired / consumed / user ineligible', body: [{ type: 'self', on: 'uc', label: 'throw per resolved state' }] },
    { type: 'message', from: 'uc', to: 'userRepo', label: 'findById(userId)' },
    { type: 'alt', label: 'user missing / already verified', body: [{ type: 'self', on: 'uc', label: 'throw per state' }] },
    { type: 'message', from: 'uc', to: 'uow', label: 'execute(transaction)' },
    { type: 'message', from: 'uow', to: 'verifyRepo', label: 'consumeIfActive(tokenId, now)' },
    { type: 'alt', label: 'concurrent consume fails', body: [{ type: 'self', on: 'uc', label: 'throw (token already consumed)' }] },
    { type: 'message', from: 'uow', to: 'userRepo', label: 'save(user.verifyEmail(now))' },
    { type: 'message', from: 'uc', to: 'events', label: 'publish(EmailVerifiedEvent)' },
  ];
  buildSequence(
    'phase-2-6-verify-email-sequence',
    'Phase 2.6 — POST /api/v1/auth/verify-email',
    participants,
    steps,
    CALL_LEGEND,
  );

  const lanes = [
    {
      name: 'Presentation',
      color: COLOR.presentation,
      items: [
        { key: 'controller', label: 'AuthController' },
        { key: 'reqDto', label: 'VerifyEmailRequestDto' },
        { key: 'resDto', label: 'VerifyEmailResponseDto' },
      ],
    },
    {
      name: 'Application',
      color: COLOR.application,
      items: [
        { key: 'uc', label: 'VerifyEmailUseCase' },
        { key: 'command', label: 'VerifyEmailCommand' },
        { key: 'result', label: 'VerifyEmailResult' },
        { key: 'appExc', label: 'Application Exceptions' },
      ],
    },
    {
      name: 'Domain',
      color: COLOR.domain,
      items: [
        { key: 'userEntity', label: 'User Entity' },
        { key: 'policy', label: 'EmailVerificationPolicy' },
        { key: 'event', label: 'EmailVerifiedEvent' },
        { key: 'userRepoPort', label: 'UserRepository Port', interface: true },
        { key: 'verifyRepoPort', label: 'EmailVerificationRepository Port', interface: true },
        { key: 'tokenSvcPort', label: 'OpaqueTokenService Port', interface: true },
      ],
    },
    {
      name: 'Infrastructure',
      color: COLOR.infrastructure,
      items: [
        { key: 'prismaUserRepo', label: 'PrismaUserRepository' },
        { key: 'prismaVerifyRepo', label: 'PrismaEmailVerificationRepository' },
        { key: 'prismaUow', label: 'PrismaUnitOfWork' },
        { key: 'prismaContext', label: 'PrismaContext' },
        { key: 'sha256', label: 'Sha256OpaqueTokenService' },
        { key: 'systemClock', label: 'SystemClock' },
        { key: 'uuidGen', label: 'UuidIdGenerator' },
        { key: 'loggingPublisher', label: 'LoggingEventPublisher' },
      ],
    },
  ];
  const edges = [
    { from: 'controller', to: 'reqDto' },
    { from: 'controller', to: 'uc' },
    { from: 'uc', to: 'command' },
    { from: 'uc', to: 'result' },
    { from: 'uc', to: 'appExc' },
    { from: 'uc', to: 'userRepoPort' },
    { from: 'uc', to: 'verifyRepoPort' },
    { from: 'uc', to: 'tokenSvcPort' },
    { from: 'uc', to: 'policy' },
    { from: 'uc', to: 'userEntity' },
    { from: 'uc', to: 'event' },
    { from: 'uc', to: 'prismaUow' },
    { from: 'uc', to: 'systemClock' },
    { from: 'uc', to: 'uuidGen' },
    { from: 'uc', to: 'loggingPublisher' },
    { from: 'prismaUow', to: 'prismaContext' },
    { from: 'prismaUserRepo', to: 'userRepoPort', dashed: true },
    { from: 'prismaVerifyRepo', to: 'verifyRepoPort', dashed: true },
    { from: 'sha256', to: 'tokenSvcPort', dashed: true },
  ];
  buildLayered(
    'phase-2-6-verify-email-dependency-graph',
    'Phase 2.6 — VerifyEmailUseCase Dependencies',
    lanes,
    edges,
    DEP_LEGEND,
  );
}

// ===========================================================================
// 8/9. phase-2-7-login
// ===========================================================================
function buildLogin() {
  const participants = [
    { key: 'client', label: 'Client', color: SEQ.actor },
    { key: 'controller', label: 'AuthController', color: SEQ.presentation },
    { key: 'uc', label: 'LoginUseCase', color: SEQ.application },
    { key: 'userRepo', label: 'UserRepo', color: SEQ.domain },
    { key: 'pwHasher', label: 'PasswordHasher', color: SEQ.domain },
    { key: 'sessionRepo', label: 'SessionRepo', color: SEQ.domain },
    { key: 'uow', label: 'UnitOfWork', color: SEQ.application },
    { key: 'tokenSvc', label: 'TokenService', color: SEQ.domain },
    { key: 'events', label: 'EventPublisher', color: SEQ.application },
  ];
  const steps = [
    { type: 'message', from: 'client', to: 'controller', label: 'POST /api/v1/auth/login' },
    { type: 'message', from: 'controller', to: 'uc', label: 'execute(email, password, device, IP, UA)' },
    { type: 'message', from: 'uc', to: 'userRepo', label: 'findByEmail' },
    { type: 'alt', label: 'user exists', body: [{ type: 'self', on: 'uc', label: 'canLogin() — locked/suspended/unverified checks' }] },
    { type: 'message', from: 'uc', to: 'pwHasher', label: 'verify (dummy hash if unknown email)' },
    { type: 'alt', label: 'invalid credentials', body: [{ type: 'message', from: 'uc', to: 'userRepo', label: 'recordFailedLogin + LoginAttempt' }] },
    { type: 'message', from: 'uc', to: 'sessionRepo', label: 'countActiveByUserId' },
    { type: 'alt', label: 'session cap reached', body: [{ type: 'self', on: 'uc', label: 'throw TooManySessionsException' }] },
    { type: 'message', from: 'uc', to: 'uow', label: 'transaction' },
    { type: 'message', from: 'uow', to: 'userRepo', label: 'save(recordSuccessfulLogin)' },
    { type: 'message', from: 'uow', to: 'sessionRepo', label: 'save(TokenFamily + DeviceSession w/ refresh hash)' },
    { type: 'message', from: 'uc', to: 'tokenSvc', label: 'signAccessToken(JWT claims)' },
    { type: 'message', from: 'uc', to: 'events', label: 'publish(UserLoggedIn)' },
  ];
  buildSequence('phase-2-7-login-sequence', 'Phase 2.7 — POST /api/v1/auth/login', participants, steps, CALL_LEGEND);

  const lanes = [
    {
      name: 'Presentation',
      color: COLOR.presentation,
      items: [
        { key: 'controller', label: 'AuthController' },
        { key: 'reqDto', label: 'LoginRequestDto' },
        { key: 'resDto', label: 'LoginResponseDto' },
      ],
    },
    {
      name: 'Application',
      color: COLOR.application,
      items: [
        { key: 'uc', label: 'LoginUseCase' },
        { key: 'ttlPort', label: 'AuthTokenTtlPort' },
        { key: 'orgReaderPort', label: 'LoginOrganizationReaderPort' },
        { key: 'sysConfigPort', label: 'SystemConfigurationPort' },
      ],
    },
    {
      name: 'Domain',
      color: COLOR.domain,
      items: [
        { key: 'userEntity', label: 'User' },
        { key: 'sessionEntity', label: 'DeviceSession' },
        { key: 'familyEntity', label: 'TokenFamily' },
        { key: 'policy', label: 'LoginPolicy / SessionPolicy' },
        { key: 'tokenSvcPort', label: 'TokenService Port', interface: true },
        { key: 'pwHasherPort', label: 'PasswordHasher Port', interface: true },
        { key: 'opaqueSvcPort', label: 'OpaqueTokenService Port', interface: true },
        { key: 'userRepoPort', label: 'UserRepository Port', interface: true },
        { key: 'sessionRepoPort', label: 'DeviceSessionRepository Port', interface: true },
        { key: 'familyRepoPort', label: 'TokenFamilyRepository Port', interface: true },
        { key: 'attemptRepoPort', label: 'LoginAttemptRepository Port', interface: true },
      ],
    },
    {
      name: 'Infrastructure',
      color: COLOR.infrastructure,
      items: [
        { key: 'prismaUserRepo', label: 'PrismaUserRepository' },
        { key: 'prismaSessionRepo', label: 'PrismaDeviceSessionRepository' },
        { key: 'prismaFamilyRepo', label: 'PrismaTokenFamilyRepository' },
        { key: 'prismaAttemptRepo', label: 'PrismaLoginAttemptRepository' },
        { key: 'prismaSysConfig', label: 'PrismaSystemConfiguration' },
        { key: 'prismaOrgReader', label: 'PrismaLoginOrganizationReader' },
        { key: 'prismaUow', label: 'PrismaUnitOfWork' },
        { key: 'jwtSvc', label: 'JwtTokenService' },
        { key: 'argon2', label: 'Argon2PasswordHasher' },
        { key: 'sha256', label: 'Sha256OpaqueTokenService' },
      ],
    },
  ];
  const edges = [
    { from: 'controller', to: 'reqDto' },
    { from: 'controller', to: 'uc' },
    { from: 'uc', to: 'ttlPort' },
    { from: 'uc', to: 'orgReaderPort' },
    { from: 'uc', to: 'sysConfigPort' },
    { from: 'uc', to: 'userEntity' },
    { from: 'uc', to: 'sessionEntity' },
    { from: 'uc', to: 'familyEntity' },
    { from: 'uc', to: 'policy' },
    { from: 'uc', to: 'tokenSvcPort' },
    { from: 'uc', to: 'pwHasherPort' },
    { from: 'uc', to: 'opaqueSvcPort' },
    { from: 'uc', to: 'userRepoPort' },
    { from: 'uc', to: 'sessionRepoPort' },
    { from: 'uc', to: 'familyRepoPort' },
    { from: 'uc', to: 'attemptRepoPort' },
    { from: 'uc', to: 'prismaUow' },
    { from: 'prismaUserRepo', to: 'userRepoPort', dashed: true },
    { from: 'prismaSessionRepo', to: 'sessionRepoPort', dashed: true },
    { from: 'prismaFamilyRepo', to: 'familyRepoPort', dashed: true },
    { from: 'prismaAttemptRepo', to: 'attemptRepoPort', dashed: true },
    { from: 'jwtSvc', to: 'tokenSvcPort', dashed: true },
    { from: 'argon2', to: 'pwHasherPort', dashed: true },
    { from: 'sha256', to: 'opaqueSvcPort', dashed: true },
    { from: 'prismaSysConfig', to: 'sysConfigPort', dashed: true },
    { from: 'prismaOrgReader', to: 'orgReaderPort', dashed: true },
  ];
  buildLayered('phase-2-7-login-dependency-graph', 'Phase 2.7 — LoginUseCase Dependencies', lanes, edges, DEP_LEGEND);
}

buildAuthAuthzModules();
buildDomainLayer();
buildDatabaseEr();
buildRegisterOwner();
buildVerifyEmail();
buildLogin();
