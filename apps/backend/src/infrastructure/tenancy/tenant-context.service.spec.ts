import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  it('returns no context and null organizationId when nothing is bound', () => {
    const service = new TenantContextService();

    expect(service.getContext()).toBeUndefined();
    expect(service.getOrganizationId()).toBeNull();
  });

  it('exposes the bound context for the duration of the callback', () => {
    const service = new TenantContextService();

    const result = service.run(
      { organizationId: 'org-1', userId: 'user-1', correlationId: 'corr-1' },
      () => {
        expect(service.getContext()).toEqual({
          organizationId: 'org-1',
          userId: 'user-1',
          correlationId: 'corr-1',
        });
        expect(service.getOrganizationId()).toBe('org-1');
        return 'callback-result';
      },
    );

    expect(result).toBe('callback-result');
  });

  it('resolves organizationId to null when the bound actor has none (e.g. Customer/User actor)', () => {
    const service = new TenantContextService();

    service.run({ organizationId: null, userId: 'user-1', correlationId: 'corr-1' }, () => {
      expect(service.getOrganizationId()).toBeNull();
    });
  });

  it('does not leak context after the callback returns', () => {
    const service = new TenantContextService();

    service.run({ organizationId: 'org-1', userId: 'user-1', correlationId: 'corr-1' }, () => {
      // no-op — context bound only within this scope
    });

    expect(service.getContext()).toBeUndefined();
    expect(service.getOrganizationId()).toBeNull();
  });

  it('propagates context through nested async/await continuations', async () => {
    const service = new TenantContextService();

    await service.run(
      { organizationId: 'org-async', userId: 'user-1', correlationId: 'corr-1' },
      async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(service.getOrganizationId()).toBe('org-async');

        await (async () => {
          await Promise.resolve();
          expect(service.getOrganizationId()).toBe('org-async');
        })();
      },
    );
  });

  it('keeps concurrent contexts isolated across interleaved async executions', async () => {
    const service = new TenantContextService();
    const observedA: (string | null)[] = [];
    const observedB: (string | null)[] = [];

    async function runAs(orgId: string, observed: (string | null)[]) {
      await service.run({ organizationId: orgId, userId: null, correlationId: orgId }, async () => {
        observed.push(service.getOrganizationId());
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        observed.push(service.getOrganizationId());
        await Promise.resolve();
        observed.push(service.getOrganizationId());
      });
    }

    await Promise.all([
      runAs('org-A', observedA),
      runAs('org-B', observedB),
      runAs('org-A-again', observedA),
    ]);

    expect(observedA.filter((id) => id === 'org-A')).toHaveLength(3);
    expect(observedA.filter((id) => id === 'org-A-again')).toHaveLength(3);
    expect(observedB.every((id) => id === 'org-B')).toBe(true);
    expect(observedB).toHaveLength(3);
  });

  it('getActorType() returns null when nothing is bound', () => {
    const service = new TenantContextService();

    expect(service.getActorType()).toBeNull();
  });

  it('getActorType() exposes the bound actorType for the duration of the callback (Phase 8 audit-hygiene fix)', () => {
    const service = new TenantContextService();

    service.run(
      { organizationId: null, userId: 'user-1', actorType: 'Employee', correlationId: 'corr-1' },
      () => {
        expect(service.getActorType()).toBe('Employee');
      },
    );

    expect(service.getActorType()).toBeNull();
  });

  it('getActorType() returns null when the bound context omits actorType (e.g. bootstrap TenantBootstrapContext)', () => {
    const service = new TenantContextService();

    service.run({ organizationId: 'org-1', userId: null, correlationId: 'corr-1' }, () => {
      expect(service.getActorType()).toBeNull();
    });
  });

  it('supports nested run() calls, restoring the outer context afterward', () => {
    const service = new TenantContextService();

    service.run({ organizationId: 'outer', userId: null, correlationId: 'c' }, () => {
      expect(service.getOrganizationId()).toBe('outer');

      service.run({ organizationId: 'inner', userId: null, correlationId: 'c' }, () => {
        expect(service.getOrganizationId()).toBe('inner');
      });

      expect(service.getOrganizationId()).toBe('outer');
    });
  });
});
