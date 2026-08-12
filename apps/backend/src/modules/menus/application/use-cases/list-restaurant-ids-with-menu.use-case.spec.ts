import { randomUUID } from 'crypto';
import { ListRestaurantIdsWithMenuUseCase } from './list-restaurant-ids-with-menu.use-case';
import { InMemoryMenuRepository } from '../../../../../test/menus/support/in-memory-menu.repository';
import { Menu } from '../../domain/entities/menu.entity';

/**
 * Phase 18 Reconciliation (2026-08-10): closes the one real gap found by the
 * Phase 18 Provenance Audit - this use case backs Discovery's `hasMenu`
 * (ADR-031 decision #9) but, unlike its exact precedent
 * (`ListRestaurantIdsWithActiveOfferUseCase`), had no dedicated unit spec.
 * Mirrors that precedent's structure exactly (in-memory repository, no real
 * database needed - the ADR-032 predicate itself, `isDefault && active &&
 * !deletedAt`, is proven against real PostgreSQL in
 * `test/menus/prisma-menu.integration-spec.ts`).
 */
describe('ListRestaurantIdsWithMenuUseCase', () => {
  const restaurantWithActiveDefaultMenu = '55555555-5555-4555-8555-555555555551';
  const restaurantWithNoMenu = '55555555-5555-4555-8555-555555555552';
  const now = new Date('2026-08-10T00:00:00.000Z');

  function build() {
    const menuRepository = new InMemoryMenuRepository();
    const useCase = new ListRestaurantIdsWithMenuUseCase(menuRepository);
    return { useCase, menuRepository };
  }

  it('returns only restaurantIds with an active, non-deleted, isDefault Menu', async () => {
    const { useCase, menuRepository } = build();

    const activeDefault = Menu.create({
      id: randomUUID(),
      restaurantId: restaurantWithActiveDefaultMenu,
      isDefault: true,
      now,
    });
    menuRepository.seed(activeDefault);

    const result = await useCase.execute({
      restaurantIds: [restaurantWithActiveDefaultMenu, restaurantWithNoMenu],
    });

    expect(result.has(restaurantWithActiveDefaultMenu)).toBe(true);
    expect(result.has(restaurantWithNoMenu)).toBe(false);
    expect(result.size).toBe(1);
  });

  it('excludes a restaurant whose only Menu is not the default', async () => {
    const { useCase, menuRepository } = build();
    const nonDefault = Menu.create({
      id: randomUUID(),
      restaurantId: restaurantWithActiveDefaultMenu,
      isDefault: false,
      now,
    });
    menuRepository.seed(nonDefault);

    const result = await useCase.execute({ restaurantIds: [restaurantWithActiveDefaultMenu] });
    expect(result.size).toBe(0);
  });

  it('excludes a restaurant whose default Menu is deactivated', async () => {
    const { useCase, menuRepository } = build();
    const inactiveDefault = Menu.create({
      id: randomUUID(),
      restaurantId: restaurantWithActiveDefaultMenu,
      isDefault: true,
      now,
    }).deactivate(now);
    menuRepository.seed(inactiveDefault);

    const result = await useCase.execute({ restaurantIds: [restaurantWithActiveDefaultMenu] });
    expect(result.size).toBe(0);
  });

  it('excludes a restaurant whose default Menu has been soft-deleted', async () => {
    const { useCase, menuRepository } = build();
    const deletedDefault = Menu.create({
      id: randomUUID(),
      restaurantId: restaurantWithActiveDefaultMenu,
      isDefault: true,
      now,
    }).softDelete(now);
    menuRepository.seed(deletedDefault);

    const result = await useCase.execute({ restaurantIds: [restaurantWithActiveDefaultMenu] });
    expect(result.size).toBe(0);
  });

  it('does not query the repository and returns an empty set for an empty input list', async () => {
    const { useCase, menuRepository } = build();
    const spy = jest.spyOn(menuRepository, 'findRestaurantIdsWithActiveDefaultMenu');

    const result = await useCase.execute({ restaurantIds: [] });

    expect(result.size).toBe(0);
    expect(spy).toHaveBeenCalledWith([]);
  });
});
