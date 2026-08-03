import { UploadMenuCategoryImageUseCase } from './upload-menu-category-image.use-case';
import { MenuCategory } from '../../domain/entities/menu-category.entity';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { InMemoryMenuCategoryRepository } from '../../../../../test/menus/support/in-memory-menu-category.repository';
import {
  FIXED_NOW,
  RESTAURANT_ID,
  testRestaurant,
  ownerActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

const MENU_ID = '10000000-0000-4000-8000-000000000001';
const validJpeg = {
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]),
  mimeType: 'image/jpeg',
  sizeBytes: 68,
};

describe('UploadMenuCategoryImageUseCase', () => {
  function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const categoryRepository = new InMemoryMenuCategoryRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const useCase = new UploadMenuCategoryImageUseCase(
      restaurantRepository,
      categoryRepository,
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
    return { useCase, restaurantRepository, categoryRepository, fileRepository, storagePort };
  }

  async function seedCategory(categoryRepository: InMemoryMenuCategoryRepository) {
    const category = MenuCategory.create({
      id: '20000000-0000-4000-8000-000000000001',
      menuId: MENU_ID,
      restaurantId: RESTAURANT_ID,
      content: { name: 'Appetizers', description: null },
      displayOrder: 0,
      now: FIXED_NOW,
    });
    await categoryRepository.create(category);
    return category;
  }

  it('uploads and sets the Category image', async () => {
    const { useCase, restaurantRepository, categoryRepository, storagePort } = build();
    await restaurantRepository.save(testRestaurant());
    await seedCategory(categoryRepository);

    const result = await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: MENU_ID,
      categoryId: '20000000-0000-4000-8000-000000000001',
      file: validJpeg,
    });

    expect(result.imageUrl).toContain('tavla-public');
    expect(storagePort.uploaded).toHaveLength(1);
    expect(storagePort.deleted).toHaveLength(0);
  });

  it('replacing the image deletes the PREVIOUS object from storage (regression guard for the orphan-cleanup bug found by menu-image-upload.e2e-spec.ts)', async () => {
    const { useCase, restaurantRepository, categoryRepository, storagePort } = build();
    await restaurantRepository.save(testRestaurant());
    await seedCategory(categoryRepository);

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: MENU_ID,
      categoryId: '20000000-0000-4000-8000-000000000001',
      file: validJpeg,
    });
    const firstObjectKey = storagePort.uploaded[0].objectKey;

    await useCase.execute({
      actor: ownerActor(),
      restaurantId: RESTAURANT_ID,
      menuId: MENU_ID,
      categoryId: '20000000-0000-4000-8000-000000000001',
      file: validJpeg,
    });

    expect(storagePort.uploaded).toHaveLength(2);
    expect(storagePort.deleted).toHaveLength(1);
    expect(storagePort.deleted[0].objectKey).toBe(firstObjectKey);
    expect(storagePort.deleted[0].bucket).toBe('tavla-public');
  });
});
