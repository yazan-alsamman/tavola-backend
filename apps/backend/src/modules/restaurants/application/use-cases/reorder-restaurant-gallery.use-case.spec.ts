import { ReorderRestaurantGalleryUseCase } from './reorder-restaurant-gallery.use-case';
import { RestaurantGalleryImage } from '../../domain/entities/restaurant-gallery-image.entity';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { InvalidRestaurantGalleryImageException } from '../../domain/exceptions/invalid-restaurant-gallery-image.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  FixedClock,
  ImmediateUnitOfWork,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantGalleryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-gallery.repository';
import {
  FIXED_NOW,
  ORGANIZATION_ID,
  RESTAURANT_ID,
  testRestaurant,
} from '../../../../../test/menus/support/menu-test-fixtures';

describe('ReorderRestaurantGalleryUseCase (ADR-046)', () => {
  const LATER = new Date('2026-08-04T10:00:00.000Z');
  const IDS = [
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000003',
  ];

  const actor = {
    actorType: AccessTokenActorType.OrganizationMember as const,
    userId: 'user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId: ORGANIZATION_ID,
    orgRole: 'Owner',
    permissionsVersion: 1,
  };

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const galleryRepository = new InMemoryRestaurantGalleryRepository();
    const auditLogWriter = new CollectingAuditLogWriter();
    await restaurantRepository.save(testRestaurant());
    for (const [index, id] of IDS.entries()) {
      await galleryRepository.add(
        RestaurantGalleryImage.create({
          id,
          restaurantId: RESTAURANT_ID,
          fileId: `bbbbbbbb-0000-4000-8000-00000000000${index + 1}`,
          caption: null,
          sortOrder: index,
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
        }),
      );
    }
    const useCase = new ReorderRestaurantGalleryUseCase(
      restaurantRepository,
      galleryRepository,
      new FixedClock(LATER),
      auditLogWriter,
      new ImmediateUnitOfWork(),
    );
    return { useCase, galleryRepository, auditLogWriter };
  }

  async function order(galleryRepository: InMemoryRestaurantGalleryRepository) {
    const images = await galleryRepository.findAllByRestaurantId(
      RestaurantId.create(RESTAURANT_ID),
    );
    return [...images].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.galleryImageId);
  }

  it('gives each image its position in the list', async () => {
    const { useCase, galleryRepository, auditLogWriter } = await build();

    await useCase.execute({
      actor,
      restaurantId: RESTAURANT_ID,
      galleryItemIds: [IDS[2], IDS[0], IDS[1]],
    });

    expect(await order(galleryRepository)).toEqual([IDS[2], IDS[0], IDS[1]]);
    expect(auditLogWriter.entries.map((e) => e.action)).toEqual(['restaurant.gallery.reordered']);
  });

  it('writes nothing when the order is unchanged', async () => {
    const { useCase, auditLogWriter } = await build();
    await useCase.execute({ actor, restaurantId: RESTAURANT_ID, galleryItemIds: IDS });
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it.each([
    ['a missing image', [IDS[0], IDS[1]]],
    ['a repeated image', [IDS[0], IDS[0], IDS[1]]],
    ['an unknown image', [IDS[0], IDS[1], 'cccccccc-0000-4000-8000-000000000001']],
  ])('rejects a list with %s', async (_label, galleryItemIds) => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor, restaurantId: RESTAURANT_ID, galleryItemIds }),
    ).rejects.toBeInstanceOf(InvalidRestaurantGalleryImageException);
  });

  it('404s for a restaurant outside the caller organization', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor,
        restaurantId: 'dddddddd-0000-4000-8000-000000000001',
        galleryItemIds: IDS,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
