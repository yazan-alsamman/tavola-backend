import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { RestaurantsController } from './restaurants.controller';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { CreateRestaurantUseCase } from '../../application/use-cases/create-restaurant.use-case';
import { GetRestaurantUseCase } from '../../application/use-cases/get-restaurant.use-case';
import { ListRestaurantsUseCase } from '../../application/use-cases/list-restaurants.use-case';
import { UpdateRestaurantUseCase } from '../../application/use-cases/update-restaurant.use-case';
import { DeleteRestaurantUseCase } from '../../application/use-cases/delete-restaurant.use-case';
import { GetRestaurantSettingsUseCase } from '../../application/use-cases/get-restaurant-settings.use-case';
import { UpdateRestaurantSettingsUseCase } from '../../application/use-cases/update-restaurant-settings.use-case';
import { GetWorkingHoursUseCase } from '../../application/use-cases/get-working-hours.use-case';
import { UpdateWorkingHoursUseCase } from '../../application/use-cases/update-working-hours.use-case';
import { AddRestaurantGalleryImageUseCase } from '../../application/use-cases/add-restaurant-gallery-image.use-case';
import { ListRestaurantGalleryUseCase } from '../../application/use-cases/list-restaurant-gallery.use-case';
import { RemoveRestaurantGalleryImageUseCase } from '../../application/use-cases/remove-restaurant-gallery-image.use-case';
import { GetRestaurantCuisineCategoriesUseCase } from '../../application/use-cases/get-restaurant-cuisine-categories.use-case';
import { SetRestaurantCuisineCategoriesUseCase } from '../../application/use-cases/set-restaurant-cuisine-categories.use-case';
import { GetRestaurantOccasionCategoriesUseCase } from '../../application/use-cases/get-restaurant-occasion-categories.use-case';
import { SetRestaurantOccasionCategoriesUseCase } from '../../application/use-cases/set-restaurant-occasion-categories.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { InvalidWorkingHoursException } from '../../domain/exceptions/invalid-working-hours.exception';
import { RestaurantGalleryLimitExceededException } from '../../domain/exceptions/restaurant-gallery-limit-exceeded.exception';
import { RestaurantGalleryItemNotFoundException } from '../../domain/exceptions/restaurant-gallery-item-not-found.exception';
import { UnknownCuisineCategoryException } from '../../domain/exceptions/unknown-cuisine-category.exception';
import { UnknownOccasionCategoryException } from '../../domain/exceptions/unknown-occasion-category.exception';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';

describe('RestaurantsController', () => {
  let controller: RestaurantsController;
  const createExecute = jest.fn();
  const getExecute = jest.fn();
  const listExecute = jest.fn();
  const updateExecute = jest.fn();
  const deleteExecute = jest.fn();
  const getSettingsExecute = jest.fn();
  const updateSettingsExecute = jest.fn();
  const getWorkingHoursExecute = jest.fn();
  const updateWorkingHoursExecute = jest.fn();
  const addGalleryImageExecute = jest.fn();
  const listGalleryExecute = jest.fn();
  const removeGalleryImageExecute = jest.fn();
  const getCuisineCategoriesExecute = jest.fn();
  const setCuisineCategoriesExecute = jest.fn();
  const getOccasionCategoriesExecute = jest.fn();
  const setOccasionCategoriesExecute = jest.fn();

  const actor: AuthenticatedOrganizationMemberActor = {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '33333333-3333-4333-8333-333333333333',
    sessionVersion: 1,
    tokenFamilyId: '22222222-2222-4222-8222-222222222222',
    organizationId: '44444444-4444-4444-8444-444444444444',
    orgRole: 'Owner',
    permissionsVersion: 1,
  };

  const restaurantResult = {
    restaurantId: '55555555-5555-4555-8555-555555555555',
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: 'Cozy',
    cuisineType: 'Italian',
    averageRating: null,
    priceLevel: 2,
    status: RestaurantStatus.Active,
    createdAt: new Date('2026-07-16T12:00:00.000Z'),
    updatedAt: new Date('2026-07-16T12:00:00.000Z'),
  };

  const restaurantSettingsResult = {
    restaurantId: '55555555-5555-4555-8555-555555555555',
    reservationIntervalMinutes: 30,
    maxGuestsPerReservation: 20,
    cancellationWindowMinutes: 60,
    pendingReservationTimeoutMinutes: 15,
    defaultReservationDurationMinutes: 90,
    autoApproval: false,
    timezone: 'UTC',
    defaultCurrency: null,
    reservationReminderMinutesBefore: 60,
    lateArrivalGraceMinutes: 15,
    createdAt: new Date('2026-07-16T12:00:00.000Z'),
    updatedAt: new Date('2026-07-16T12:00:00.000Z'),
  };

  const workingHoursResult = {
    restaurantId: '55555555-5555-4555-8555-555555555555',
    entries: [
      {
        dayOfWeek: 1,
        openingTime: '09:00',
        closingTime: '22:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: new Date('2026-07-16T12:00:00.000Z'),
        updatedAt: new Date('2026-07-16T12:00:00.000Z'),
      },
    ],
  };

  const galleryImageResult = {
    galleryItemId: '66666666-6666-4666-8666-666666666666',
    restaurantId: '55555555-5555-4555-8555-555555555555',
    caption: 'Our dining room',
    sortOrder: 0,
    imageUrl: 'https://signed.example.com/tavla-public/restaurants/.../gallery/x.jpg',
    createdAt: new Date('2026-07-16T12:00:00.000Z'),
    updatedAt: new Date('2026-07-16T12:00:00.000Z'),
  };

  const galleryListResult = {
    restaurantId: '55555555-5555-4555-8555-555555555555',
    items: [galleryImageResult],
  };

  const cuisineCategoryResult = {
    cuisineCategoryId: '77777777-7777-4777-8777-777777777777',
    slug: 'italian',
    name: 'Italian',
    sortOrder: 0,
    createdAt: new Date('2026-07-16T12:00:00.000Z'),
    updatedAt: new Date('2026-07-16T12:00:00.000Z'),
  };

  const restaurantCuisineCategoriesResult = {
    restaurantId: '55555555-5555-4555-8555-555555555555',
    categories: [cuisineCategoryResult],
  };

  const occasionCategoryResult = {
    occasionCategoryId: '88888888-8888-4888-8888-888888888888',
    slug: 'date-night',
    name: 'Date Night',
    sortOrder: 0,
    createdAt: new Date('2026-07-16T12:00:00.000Z'),
    updatedAt: new Date('2026-07-16T12:00:00.000Z'),
  };

  const restaurantOccasionCategoriesResult = {
    restaurantId: '55555555-5555-4555-8555-555555555555',
    categories: [occasionCategoryResult],
  };

  function buildRequest(headers: Record<string, string> = {}): Request {
    return { headers } as unknown as Request;
  }

  beforeEach(async () => {
    createExecute.mockReset();
    getExecute.mockReset();
    listExecute.mockReset();
    updateExecute.mockReset();
    deleteExecute.mockReset();
    getSettingsExecute.mockReset();
    updateSettingsExecute.mockReset();
    getWorkingHoursExecute.mockReset();
    updateWorkingHoursExecute.mockReset();
    addGalleryImageExecute.mockReset();
    listGalleryExecute.mockReset();
    removeGalleryImageExecute.mockReset();
    getCuisineCategoriesExecute.mockReset();
    setCuisineCategoriesExecute.mockReset();
    getOccasionCategoriesExecute.mockReset();
    setOccasionCategoriesExecute.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RestaurantsController],
      providers: [
        { provide: CreateRestaurantUseCase, useValue: { execute: createExecute } },
        { provide: GetRestaurantUseCase, useValue: { execute: getExecute } },
        { provide: ListRestaurantsUseCase, useValue: { execute: listExecute } },
        { provide: UpdateRestaurantUseCase, useValue: { execute: updateExecute } },
        { provide: DeleteRestaurantUseCase, useValue: { execute: deleteExecute } },
        { provide: GetRestaurantSettingsUseCase, useValue: { execute: getSettingsExecute } },
        {
          provide: UpdateRestaurantSettingsUseCase,
          useValue: { execute: updateSettingsExecute },
        },
        { provide: GetWorkingHoursUseCase, useValue: { execute: getWorkingHoursExecute } },
        {
          provide: UpdateWorkingHoursUseCase,
          useValue: { execute: updateWorkingHoursExecute },
        },
        {
          provide: AddRestaurantGalleryImageUseCase,
          useValue: { execute: addGalleryImageExecute },
        },
        { provide: ListRestaurantGalleryUseCase, useValue: { execute: listGalleryExecute } },
        {
          provide: RemoveRestaurantGalleryImageUseCase,
          useValue: { execute: removeGalleryImageExecute },
        },
        {
          provide: GetRestaurantCuisineCategoriesUseCase,
          useValue: { execute: getCuisineCategoriesExecute },
        },
        {
          provide: SetRestaurantCuisineCategoriesUseCase,
          useValue: { execute: setCuisineCategoriesExecute },
        },
        {
          provide: GetRestaurantOccasionCategoriesUseCase,
          useValue: { execute: getOccasionCategoriesExecute },
        },
        {
          provide: SetRestaurantOccasionCategoriesUseCase,
          useValue: { execute: setOccasionCategoriesExecute },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(SessionVersionGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(OrganizationMemberGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get(RestaurantsController);
  });

  describe('create', () => {
    it('delegates to the use case with the actor from the JWT, never a client-supplied organizationId', async () => {
      createExecute.mockResolvedValue(restaurantResult);

      const response = await controller.create(
        { name: 'The Old Mill', description: 'Cozy', cuisineType: 'Italian', priceLevel: 2 },
        actor,
        buildRequest({ 'x-correlation-id': 'corr-1' }),
      );

      expect(createExecute).toHaveBeenCalledWith({
        actor,
        name: 'The Old Mill',
        slug: undefined,
        description: 'Cozy',
        cuisineType: 'Italian',
        priceLevel: 2,
        correlationId: 'corr-1',
      });
      expect(response.restaurantId).toBe(restaurantResult.restaurantId);
      expect(response.slug).toBe('the-old-mill');
    });

    it('normalizes omitted optional fields to null', async () => {
      createExecute.mockResolvedValue(restaurantResult);

      await controller.create({ name: 'The Old Mill' }, actor, buildRequest());

      expect(createExecute).toHaveBeenCalledWith(
        expect.objectContaining({ description: null, cuisineType: null, priceLevel: null }),
      );
    });
  });

  describe('getById', () => {
    it('delegates to the use case and maps the documented fields', async () => {
      getExecute.mockResolvedValue(restaurantResult);

      const response = await controller.getById(restaurantResult.restaurantId, actor);

      expect(getExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantResult.restaurantId,
      });
      expect(response.name).toBe('The Old Mill');
      expect(response.createdAt).toBe('2026-07-16T12:00:00.000Z');
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      getExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(controller.getById(restaurantResult.restaurantId, actor)).rejects.toBeInstanceOf(
        RestaurantNotFoundException,
      );
    });
  });

  describe('list', () => {
    it('delegates to the use case with actor and pagination', async () => {
      listExecute.mockResolvedValue({
        items: [restaurantResult],
        page: 2,
        limit: 10,
        total: 1,
      });

      const response = await controller.list({ page: 2, limit: 10 }, actor);

      expect(listExecute).toHaveBeenCalledWith({ actor, page: 2, limit: 10 });
      expect(response.items).toHaveLength(1);
      expect(response.total).toBe(1);
    });

    it('defaults page/limit to 1/20 when omitted', async () => {
      listExecute.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 });

      await controller.list({}, actor);

      expect(listExecute).toHaveBeenCalledWith({ actor, page: 1, limit: 20 });
    });
  });

  describe('update', () => {
    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      updateExecute.mockResolvedValue({ ...restaurantResult, name: 'New Name' });

      const response = await controller.update(
        restaurantResult.restaurantId,
        {
          name: 'New Name',
          description: 'New description',
          cuisineType: 'French',
          priceLevel: 4,
          status: RestaurantStatus.Active,
        },
        actor,
        buildRequest({ 'x-correlation-id': 'corr-2' }),
      );

      expect(updateExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantResult.restaurantId,
        name: 'New Name',
        description: 'New description',
        cuisineType: 'French',
        priceLevel: 4,
        status: RestaurantStatus.Active,
        correlationId: 'corr-2',
      });
      expect(response.name).toBe('New Name');
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      updateExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.update(
          restaurantResult.restaurantId,
          { name: 'New Name', status: RestaurantStatus.Active },
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('delete', () => {
    it('delegates to the use case with the actor from the JWT', async () => {
      deleteExecute.mockResolvedValue(undefined);

      const response = await controller.delete(
        restaurantResult.restaurantId,
        actor,
        buildRequest({ 'x-correlation-id': 'corr-3' }),
      );

      expect(deleteExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantResult.restaurantId,
        correlationId: 'corr-3',
      });
      expect(response).toBeUndefined();
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      deleteExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.delete(restaurantResult.restaurantId, actor, buildRequest()),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('getSettings', () => {
    it('delegates to the use case and maps the documented fields', async () => {
      getSettingsExecute.mockResolvedValue(restaurantSettingsResult);

      const response = await controller.getSettings(restaurantSettingsResult.restaurantId, actor);

      expect(getSettingsExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantSettingsResult.restaurantId,
      });
      expect(response.reservationIntervalMinutes).toBe(30);
      expect(response.timezone).toBe('UTC');
      expect(response.createdAt).toBe('2026-07-16T12:00:00.000Z');
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      getSettingsExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.getSettings(restaurantSettingsResult.restaurantId, actor),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('updateSettings', () => {
    const requestBody = {
      reservationIntervalMinutes: 45,
      maxGuestsPerReservation: 12,
      cancellationWindowMinutes: 120,
      pendingReservationTimeoutMinutes: 30,
      defaultReservationDurationMinutes: 120,
      autoApproval: true,
      timezone: 'Europe/Istanbul',
      defaultCurrency: 'TRY',
      reservationReminderMinutesBefore: 90,
      lateArrivalGraceMinutes: 20,
    };

    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      updateSettingsExecute.mockResolvedValue({
        ...restaurantSettingsResult,
        ...requestBody,
      });

      const response = await controller.updateSettings(
        restaurantSettingsResult.restaurantId,
        requestBody,
        actor,
        buildRequest({ 'x-correlation-id': 'corr-4' }),
      );

      expect(updateSettingsExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantSettingsResult.restaurantId,
        ...requestBody,
        correlationId: 'corr-4',
      });
      expect(response.reservationIntervalMinutes).toBe(45);
      expect(response.defaultCurrency).toBe('TRY');
    });

    it('normalizes an omitted defaultCurrency to null', async () => {
      updateSettingsExecute.mockResolvedValue(restaurantSettingsResult);

      await controller.updateSettings(
        restaurantSettingsResult.restaurantId,
        { ...requestBody, defaultCurrency: undefined },
        actor,
        buildRequest(),
      );

      expect(updateSettingsExecute).toHaveBeenCalledWith(
        expect.objectContaining({ defaultCurrency: null }),
      );
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      updateSettingsExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.updateSettings(
          restaurantSettingsResult.restaurantId,
          requestBody,
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('getWorkingHours', () => {
    it('delegates to the use case and maps the documented fields', async () => {
      getWorkingHoursExecute.mockResolvedValue(workingHoursResult);

      const response = await controller.getWorkingHours(workingHoursResult.restaurantId, actor);

      expect(getWorkingHoursExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: workingHoursResult.restaurantId,
      });
      expect(response.entries).toHaveLength(1);
      expect(response.entries[0]).toMatchObject({
        dayOfWeek: 1,
        openingTime: '09:00',
        closingTime: '22:00',
        createdAt: '2026-07-16T12:00:00.000Z',
      });
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      getWorkingHoursExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.getWorkingHours(workingHoursResult.restaurantId, actor),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('updateWorkingHours', () => {
    const requestBody = {
      entries: [
        {
          dayOfWeek: 1,
          openingTime: '09:00',
          closingTime: '22:00',
          breakStartTime: undefined,
          breakEndTime: undefined,
        },
      ],
    };

    it('delegates to the use case with the actor from the JWT, never a client-supplied id, normalizing omitted break fields to null', async () => {
      updateWorkingHoursExecute.mockResolvedValue(workingHoursResult);

      const response = await controller.updateWorkingHours(
        workingHoursResult.restaurantId,
        requestBody,
        actor,
        buildRequest({ 'x-correlation-id': 'corr-5' }),
      );

      expect(updateWorkingHoursExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: workingHoursResult.restaurantId,
        entries: [
          {
            dayOfWeek: 1,
            openingTime: '09:00',
            closingTime: '22:00',
            breakStartTime: null,
            breakEndTime: null,
          },
        ],
        correlationId: 'corr-5',
      });
      expect(response.entries).toHaveLength(1);
    });

    it('propagates InvalidWorkingHoursException from the use case unchanged', async () => {
      updateWorkingHoursExecute.mockRejectedValue(
        new InvalidWorkingHoursException('Duplicate dayOfWeek 1 in request.'),
      );

      await expect(
        controller.updateWorkingHours(
          workingHoursResult.restaurantId,
          requestBody,
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(InvalidWorkingHoursException);
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      updateWorkingHoursExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.updateWorkingHours(
          workingHoursResult.restaurantId,
          requestBody,
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('addGalleryImage', () => {
    const uploadedFile = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      mimetype: 'image/jpeg',
      size: 4,
    } as Express.Multer.File;

    it('delegates to the use case with the actor from the JWT, mapping the multipart file and caption', async () => {
      addGalleryImageExecute.mockResolvedValue(galleryImageResult);

      const response = await controller.addGalleryImage(
        galleryImageResult.restaurantId,
        uploadedFile,
        { caption: 'Our dining room' },
        actor,
        buildRequest({ 'x-correlation-id': 'corr-6' }),
      );

      expect(addGalleryImageExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: galleryImageResult.restaurantId,
        file: { buffer: uploadedFile.buffer, mimeType: 'image/jpeg', sizeBytes: 4 },
        caption: 'Our dining room',
        correlationId: 'corr-6',
      });
      expect(response.galleryItemId).toBe(galleryImageResult.galleryItemId);
    });

    it('normalizes a missing file to null and an omitted caption to null', async () => {
      addGalleryImageExecute.mockResolvedValue(galleryImageResult);

      await controller.addGalleryImage(
        galleryImageResult.restaurantId,
        undefined,
        {},
        actor,
        buildRequest(),
      );

      expect(addGalleryImageExecute).toHaveBeenCalledWith(
        expect.objectContaining({ file: null, caption: null }),
      );
    });

    it('propagates RestaurantGalleryLimitExceededException from the use case unchanged', async () => {
      addGalleryImageExecute.mockRejectedValue(new RestaurantGalleryLimitExceededException(20));

      await expect(
        controller.addGalleryImage(
          galleryImageResult.restaurantId,
          uploadedFile,
          {},
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantGalleryLimitExceededException);
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      addGalleryImageExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.addGalleryImage(
          galleryImageResult.restaurantId,
          uploadedFile,
          {},
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('listGallery', () => {
    it('delegates to the use case and maps the documented fields', async () => {
      listGalleryExecute.mockResolvedValue(galleryListResult);

      const response = await controller.listGallery(galleryListResult.restaurantId, actor);

      expect(listGalleryExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: galleryListResult.restaurantId,
      });
      expect(response.items).toHaveLength(1);
      expect(response.items[0].caption).toBe('Our dining room');
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      listGalleryExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.listGallery(galleryListResult.restaurantId, actor),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('removeGalleryImage', () => {
    it('delegates to the use case with the actor from the JWT', async () => {
      removeGalleryImageExecute.mockResolvedValue(undefined);

      const response = await controller.removeGalleryImage(
        galleryImageResult.restaurantId,
        galleryImageResult.galleryItemId,
        actor,
        buildRequest({ 'x-correlation-id': 'corr-7' }),
      );

      expect(removeGalleryImageExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: galleryImageResult.restaurantId,
        galleryItemId: galleryImageResult.galleryItemId,
        correlationId: 'corr-7',
      });
      expect(response).toBeUndefined();
    });

    it('propagates RestaurantGalleryItemNotFoundException from the use case unchanged', async () => {
      removeGalleryImageExecute.mockRejectedValue(new RestaurantGalleryItemNotFoundException());

      await expect(
        controller.removeGalleryImage(
          galleryImageResult.restaurantId,
          galleryImageResult.galleryItemId,
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantGalleryItemNotFoundException);
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      removeGalleryImageExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.removeGalleryImage(
          galleryImageResult.restaurantId,
          galleryImageResult.galleryItemId,
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('getCuisineCategories', () => {
    it('delegates to the use case and maps the documented fields', async () => {
      getCuisineCategoriesExecute.mockResolvedValue(restaurantCuisineCategoriesResult);

      const response = await controller.getCuisineCategories(
        restaurantCuisineCategoriesResult.restaurantId,
        actor,
      );

      expect(getCuisineCategoriesExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantCuisineCategoriesResult.restaurantId,
      });
      expect(response.categories).toHaveLength(1);
      expect(response.categories[0].slug).toBe('italian');
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      getCuisineCategoriesExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.getCuisineCategories(restaurantCuisineCategoriesResult.restaurantId, actor),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('setCuisineCategories', () => {
    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      setCuisineCategoriesExecute.mockResolvedValue(restaurantCuisineCategoriesResult);

      const response = await controller.setCuisineCategories(
        restaurantCuisineCategoriesResult.restaurantId,
        { cuisineCategoryIds: [cuisineCategoryResult.cuisineCategoryId] },
        actor,
        buildRequest({ 'x-correlation-id': 'corr-8' }),
      );

      expect(setCuisineCategoriesExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantCuisineCategoriesResult.restaurantId,
        cuisineCategoryIds: [cuisineCategoryResult.cuisineCategoryId],
        correlationId: 'corr-8',
      });
      expect(response.categories).toHaveLength(1);
    });

    it('propagates UnknownCuisineCategoryException from the use case unchanged', async () => {
      setCuisineCategoriesExecute.mockRejectedValue(new UnknownCuisineCategoryException());

      await expect(
        controller.setCuisineCategories(
          restaurantCuisineCategoriesResult.restaurantId,
          { cuisineCategoryIds: ['does-not-exist'] },
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(UnknownCuisineCategoryException);
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      setCuisineCategoriesExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.setCuisineCategories(
          restaurantCuisineCategoriesResult.restaurantId,
          { cuisineCategoryIds: [] },
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('getOccasionCategories', () => {
    it('delegates to the use case and maps the documented fields', async () => {
      getOccasionCategoriesExecute.mockResolvedValue(restaurantOccasionCategoriesResult);

      const response = await controller.getOccasionCategories(
        restaurantOccasionCategoriesResult.restaurantId,
        actor,
      );

      expect(getOccasionCategoriesExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantOccasionCategoriesResult.restaurantId,
      });
      expect(response.categories).toHaveLength(1);
      expect(response.categories[0].slug).toBe('date-night');
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      getOccasionCategoriesExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.getOccasionCategories(restaurantOccasionCategoriesResult.restaurantId, actor),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('setOccasionCategories', () => {
    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      setOccasionCategoriesExecute.mockResolvedValue(restaurantOccasionCategoriesResult);

      const response = await controller.setOccasionCategories(
        restaurantOccasionCategoriesResult.restaurantId,
        { occasionCategoryIds: [occasionCategoryResult.occasionCategoryId] },
        actor,
        buildRequest({ 'x-correlation-id': 'corr-9' }),
      );

      expect(setOccasionCategoriesExecute).toHaveBeenCalledWith({
        actor,
        restaurantId: restaurantOccasionCategoriesResult.restaurantId,
        occasionCategoryIds: [occasionCategoryResult.occasionCategoryId],
        correlationId: 'corr-9',
      });
      expect(response.categories).toHaveLength(1);
    });

    it('propagates UnknownOccasionCategoryException from the use case unchanged', async () => {
      setOccasionCategoriesExecute.mockRejectedValue(new UnknownOccasionCategoryException());

      await expect(
        controller.setOccasionCategories(
          restaurantOccasionCategoriesResult.restaurantId,
          { occasionCategoryIds: ['does-not-exist'] },
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(UnknownOccasionCategoryException);
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      setOccasionCategoriesExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.setOccasionCategories(
          restaurantOccasionCategoriesResult.restaurantId,
          { occasionCategoryIds: [] },
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });
});
