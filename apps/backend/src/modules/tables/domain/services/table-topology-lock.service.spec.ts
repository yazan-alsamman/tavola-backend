import { TableTopologyLockService } from './table-topology-lock.service';

/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #7). Pure, dependency-free
 * unit coverage for the deterministic sorted-key derivation shared by
 * `PrismaTableRepository.acquireTopologyLocks` and every Reservation write
 * path (Create/Approve/Reschedule/Waitlist-reserve) that must acquire the
 * SAME topology locks, in the SAME order, before their own ADR-013/023 slot
 * locks - see the class's own doc comment.
 */
describe('TableTopologyLockService', () => {
  describe('deriveLockKey()', () => {
    it('namespaces the key under "topology:table:" so it never collides with ADR-013/023 slot-bucket keys', () => {
      const key = TableTopologyLockService.deriveLockKey('11111111-1111-4111-8111-111111111111');
      expect(key).toBe('topology:table:11111111-1111-4111-8111-111111111111');
    });

    it('is a pure function: the same id always derives the same key', () => {
      const id = '22222222-2222-4222-8222-222222222222';
      expect(TableTopologyLockService.deriveLockKey(id)).toBe(
        TableTopologyLockService.deriveLockKey(id),
      );
    });

    it('derives distinct keys for distinct ids', () => {
      const keyA = TableTopologyLockService.deriveLockKey('11111111-1111-4111-8111-111111111111');
      const keyB = TableTopologyLockService.deriveLockKey('22222222-2222-4222-8222-222222222222');
      expect(keyA).not.toBe(keyB);
    });
  });

  describe('sortTableIds()', () => {
    it('sorts ids ascending (lexicographic)', () => {
      const sorted = TableTopologyLockService.sortTableIds(['c-table', 'a-table', 'b-table']);
      expect(sorted).toEqual(['a-table', 'b-table', 'c-table']);
    });

    it('deduplicates repeated ids', () => {
      const sorted = TableTopologyLockService.sortTableIds(['a-table', 'a-table', 'b-table']);
      expect(sorted).toEqual(['a-table', 'b-table']);
    });

    it('produces the SAME sorted order regardless of the caller-supplied order (deadlock-avoidance guarantee)', () => {
      const forward = TableTopologyLockService.sortTableIds(['a-table', 'b-table', 'c-table']);
      const reverse = TableTopologyLockService.sortTableIds(['c-table', 'b-table', 'a-table']);
      const shuffled = TableTopologyLockService.sortTableIds(['b-table', 'c-table', 'a-table']);

      expect(reverse).toEqual(forward);
      expect(shuffled).toEqual(forward);
    });

    it('does not mutate the input array', () => {
      const input = ['c-table', 'a-table', 'b-table'];
      const inputCopy = [...input];
      TableTopologyLockService.sortTableIds(input);
      expect(input).toEqual(inputCopy);
    });

    it('handles a single id and an empty list', () => {
      expect(TableTopologyLockService.sortTableIds(['only-table'])).toEqual(['only-table']);
      expect(TableTopologyLockService.sortTableIds([])).toEqual([]);
    });
  });

  describe('deriveLockKeysInOrder()', () => {
    it('returns deduplicated, sorted, namespaced keys in one step', () => {
      const keys = TableTopologyLockService.deriveLockKeysInOrder([
        'c-table',
        'a-table',
        'a-table',
        'b-table',
      ]);
      expect(keys).toEqual([
        'topology:table:a-table',
        'topology:table:b-table',
        'topology:table:c-table',
      ]);
    });

    it('two callers requesting the same set of table ids in different orders always acquire locks in the same order (no deadlock, ADR-026 decision #7)', () => {
      const requestA = TableTopologyLockService.deriveLockKeysInOrder(['t2', 't1', 't3']);
      const requestB = TableTopologyLockService.deriveLockKeysInOrder(['t3', 't2', 't1']);
      expect(requestA).toEqual(requestB);
    });
  });
});
