Proceed with Option 1.

This is an explicit architecture decision.

==================================================
Architecture Decision
==================================================

Phase 4.3 implements ONLY Restaurant-level Working Hours.

Branch-level Working Hours are explicitly deferred to Phase 5 (Branch Module).

Do NOT implement any Branch Working Hours logic.

Do NOT implement branch overrides.

Do NOT introduce any dependency on the Branch module.

Do NOT expand scope.

==================================================
Existing Documentation Conflict
==================================================

Treat the current documentation conflict as follows:

- DOMAIN_MODEL.md is authoritative for aggregate ownership in this phase.
- Restaurant owns Working Hours in Phase 4.
- Branch-level Working Hours become part of Phase 5 when the Branch aggregate is implemented.

Do NOT redesign the architecture.

Do NOT introduce a dual-parent aggregate now.

==================================================
Branch.openingHours
==================================================

The existing undocumented Branch.openingHours Json? field is acknowledged as a pre-existing inconsistency.

Do NOT use it.

Do NOT remove it.

Do NOT migrate it.

Do NOT build around it.

Simply document it in the final report as deferred technical debt outside the scope of Phase 4.

==================================================
Business Rules
==================================================

Where business rules are not explicitly documented
(day validation,
time validation,
cross-midnight,
overlap detection,
etc.)

derive the smallest possible implementation that is fully consistent with the existing Restaurant architecture.

Do NOT invent future functionality.

Do NOT add optional features.

Keep the implementation intentionally minimal.

==================================================
Documentation
==================================================

If a documentation clarification is required,

update only the documentation necessary to reconcile Phase 4.3 with this explicit decision.

Do not create ADRs.

==================================================
Continue from Step 5.

Implement Restaurant Working Hours only.

After implementation execute the full verification pipeline exactly as in previous phases.

Stop after the final engineering report.

Do not begin Phase 5.