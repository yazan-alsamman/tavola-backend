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
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { InvalidWorkingHoursException } from '../../domain/exceptions/invalid-working-hours.exception';
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
    autoApproval: false,
    timezone: 'UTC',
    defaultCurrency: null,
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
      autoApproval: true,
      timezone: 'Europe/Istanbul',
      defaultCurrency: 'TRY',
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
});
