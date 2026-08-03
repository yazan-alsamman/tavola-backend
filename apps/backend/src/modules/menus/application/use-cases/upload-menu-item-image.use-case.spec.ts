import { UploadMenuItemImageUseCase } from './upload-menu-item-image.use-case';
import { MenuItem } from '../../domain/entities/menu-item.entity';
import { MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { InMemoryMenuItemRepository } from '../../../../../test/menus/support/in-memory-menu-item.repository';
import {
  FIXED_NOW,
  RESTAURANT_ID,
  testRestaurant,
  ownerActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

const MENU_ID = '10000000-0000-4000-8000-000000000001';
const CATEGORY_ID = '20000000-0000-4000-8000-000000000001';
const validJpeg = {
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]),
  mimeType: 'image/jpeg',
  sizeBytes: 68,
};

describe('UploadMenuItemImageUseCase', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const itemRepository = new InMemoryMenuItemRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const useCase = new UploadMenuItemImageUseCase(
      restaurantRepository,
      itemRepository,
      fileRepository,
      storagePort,
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator([
        'aaaaaaaa-0001-4000-8000-000000000001',
        'aaaaaaaa-0001-4000-8000-000000000002',
        'aaaaaaaa-0001-4000-8000-000000000003',
        'aaaaaaaa-0001-4000-8000-000000000004',
      ]),
      new CollectingEventPublisher(),
      'tavla-public',
    );
    return { useCase, restaurantRepository, itemRepository, storagePort };
  }

  async function seedItem(itemRepository: InMemoryMenuItemRepository) {
    const item = MenuItem.create({
      id: '30000000-0000-4000-8000-000000000001',
      categoryId: CATEGORY_ID,
      restaurantId: RESTAURANT_ID,
      content: {
        name: 'Margherita',
        description: null,
        price: 10,
        currency: null,
        preparationTimeMinutes: null,
        spicyLevel: null,
        calories: null,
        allergens: [],
        dietaryLabels: [] as MenuItemDietaryLabel[],
      },
      displayOrder: 0,
      now: FIXED_NOW,
    });
    await itemRepository.create(item);
    return item;
  }

  it('replacing the image deletes the PREVIOUS object from storage (regression guard for the orphan-cleanup bug found by menu-image-upload.e2e-spec.ts)', async () => {
    const { useCase, restaurantRepository, itemRepository, storagePort } = build();
    await restaurantRepository.save(testRestaurant());
    await seedItem(itemRepository);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: MENU_ID,
      categoryId: CATEGORY_ID,
      itemId: '30000000-0000-4000-8000-000000000001',
      file: validJpeg,
    });
    const firstObjectKey = storagePort.uploaded[0].objectKey;

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: MENU_ID,
      categoryId: CATEGORY_ID,
      itemId: '30000000-0000-4000-8000-000000000001',
      file: validJpeg,
    });

    expect(storagePort.uploaded).toHaveLength(2);
    expect(storagePort.deleted).toHaveLength(1);
    expect(storagePort.deleted[0].objectKey).toBe(firstObjectKey);
  });
});
