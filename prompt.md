Before writing any code, resolve these two open points explicitly and record your
resolution in the Phase 7.0 decision note (same TASKS.md format as prior sub-phases):

1. Authorization scope: confirm whether Owner/Admin-only (OrganizationMemberGuard +
   RequireOrgRole) is a deliberate Phase 7.0 scoping decision, given
   AUTHORIZATION_ARCHITECTURE.md §5 documents employees:manage as an operational RBAC
   permission typically held by Manager. If it's deliberate, state the reason (e.g.
   "creating accounts with role/permission grants warrants org-admin trust for this
   first increment; Manager-driven employees:manage access is deferred to a future
   sub-phase") explicitly in the note. If it's not deliberate and Manager access via
   employees:manage should actually be wired now, say so and adjust the guard stack
   accordingly before implementing.

2. Session/token invalidation on Remove/Deactivate Employee: confirm whether removing
   or deactivating an Employee should bump the linked User's sessionVersion (forcing
   their active sessions to be rejected on next request/refresh), mirroring
   AUTHENTICATION_ARCHITECTURE.md's existing "Admin suspends user → all sessions"
   revocation trigger. If yes, add that step to RemoveEmployeeUseCase/the deactivate
   path now, inside the same transaction as the deletedAt write. If there's a reason
   to defer this (e.g. it's out of scope because Employee suspension is judged
   lower-severity than full User suspension), state that reasoning explicitly rather
   than leaving the gap silent.

Once both are resolved and recorded, proceed with implementation exactly as planned —
the rest of the plan (entity methods, repository methods, use cases, controller,
first-login linking, events, folder structure) is approved as-is. Implement Phase 7.0
in full, then stop for review before touching any Phase 7.1 (Reservation Core) code.