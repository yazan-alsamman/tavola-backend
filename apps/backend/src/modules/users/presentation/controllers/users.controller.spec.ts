import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { UsersController } from './users.controller';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { GetCurrentUserProfileUseCase } from '../../application/use-cases/get-current-user-profile.use-case';
import { UpdateUserProfileUseCase } from '../../application/use-cases/update-user-profile.use-case';
import { UploadCurrentUserAvatarUseCase } from '../../application/use-cases/upload-current-user-avatar.use-case';
import { AddFavoriteUseCase } from '../../application/use-cases/add-favorite.use-case';
import { RemoveFavoriteUseCase } from '../../application/use-cases/remove-favorite.use-case';
import { ListCurrentUserFavoritesUseCase } from '../../application/use-cases/list-current-user-favorites.use-case';
import { GetCurrentUserPreferencesUseCase } from '../../application/use-cases/get-current-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from '../../application/use-cases/update-user-preferences.use-case';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { RestaurantNotFoundException } from '../../application/exceptions/restaurant-not-found.exception';
import { AuthenticatedUserActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';

describe('UsersController', () => {
  let controller: UsersController;
  const getExecute = jest.fn();
  const updateExecute = jest.fn();
  const uploadAvatarExecute = jest.fn();
  const addFavoriteExecute = jest.fn();
  const removeFavoriteExecute = jest.fn();
  const listFavoritesExecute = jest.fn();
  const getPreferencesExecute = jest.fn();
  const updatePreferencesExecute = jest.fn();

  const actor: AuthenticatedUserActor = {
    actorType: AccessTokenActorType.User,
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '33333333-3333-4333-8333-333333333333',
    sessionVersion: 1,
    tokenFamilyId: '22222222-2222-4222-8222-222222222222',
  };

  const profileResult = {
    userId: actor.userId,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: null,
    language: 'en',
    preferredCurrency: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  beforeEach(async () => {
    getExecute.mockReset();
    updateExecute.mockReset();
    uploadAvatarExecute.mockReset();
    addFavoriteExecute.mockReset();
    removeFavoriteExecute.mockReset();
    listFavoritesExecute.mockReset();
    getPreferencesExecute.mockReset();
    updatePreferencesExecute.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: GetCurrentUserProfileUseCase, useValue: { execute: getExecute } },
        { provide: UpdateUserProfileUseCase, useValue: { execute: updateExecute } },
        { provide: UploadCurrentUserAvatarUseCase, useValue: { execute: uploadAvatarExecute } },
        { provide: AddFavoriteUseCase, useValue: { execute: addFavoriteExecute } },
        { provide: RemoveFavoriteUseCase, useValue: { execute: removeFavoriteExecute } },
        { provide: ListCurrentUserFavoritesUseCase, useValue: { execute: listFavoritesExecute } },
        { provide: GetCurrentUserPreferencesUseCase, useValue: { execute: getPreferencesExecute } },
        {
          provide: UpdateUserPreferencesUseCase,
          useValue: { execute: updatePreferencesExecute },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(SessionVersionGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get(UsersController);
  });

  describe('getCurrentProfile', () => {
    it('delegates to the use case using only the JWT actor and maps the documented fields', async () => {
      getExecute.mockResolvedValue(profileResult);

      const response = await controller.getCurrentProfile(actor);

      expect(getExecute).toHaveBeenCalledWith({ actor });
      expect(response).toEqual({
        userId: actor.userId,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        phone: null,
        language: 'en',
        preferredCurrency: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
      // Never re-exposes Authentication-internal fields even if a future
      // change accidentally widened UserProfileResult.
      expect(response).not.toHaveProperty('passwordHash');
      expect(response).not.toHaveProperty('sessionVersion');
      expect(response).not.toHaveProperty('status');
    });

    it('propagates UserNotFoundException from the use case unchanged', async () => {
      getExecute.mockRejectedValue(new UserNotFoundException());

      await expect(controller.getCurrentProfile(actor)).rejects.toBeInstanceOf(
        UserNotFoundException,
      );
    });
  });

  describe('updateCurrentProfile', () => {
    function buildRequest(headers: Record<string, string> = {}): Request {
      return {
        ip: '203.0.113.44',
        socket: { remoteAddress: '127.0.0.1' },
        headers,
      } as unknown as Request;
    }

    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      updateExecute.mockResolvedValue({
        ...profileResult,
        firstName: 'Updated',
        lastName: 'Person',
        phone: '+963900000000',
        language: 'ar',
        preferredCurrency: 'USD',
      });

      const response = await controller.updateCurrentProfile(
        {
          firstName: 'Updated',
          lastName: 'Person',
          countryCode: 'SY',
          phoneNumber: '900000000',
          language: 'ar',
          preferredCurrency: 'USD',
        },
        actor,
        buildRequest({ 'x-correlation-id': 'corr-123' }),
      );

      expect(updateExecute).toHaveBeenCalledWith({
        actor,
        firstName: 'Updated',
        lastName: 'Person',
        countryCode: 'SY',
        phoneNumber: '900000000',
        language: 'ar',
        preferredCurrency: 'USD',
        ipAddress: '203.0.113.44',
        correlationId: 'corr-123',
      });
      expect(response.firstName).toBe('Updated');
      expect(response.language).toBe('ar');
    });

    it('normalizes omitted optional fields to null (full-replace semantics)', async () => {
      updateExecute.mockResolvedValue(profileResult);

      await controller.updateCurrentProfile(
        { firstName: 'Jane', lastName: 'Doe', language: 'en' },
        actor,
        buildRequest(),
      );

      expect(updateExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          countryCode: null,
          phoneNumber: null,
          preferredCurrency: null,
          correlationId: undefined,
        }),
      );
    });

    it('propagates UserNotFoundException from the use case unchanged', async () => {
      updateExecute.mockRejectedValue(new UserNotFoundException());

      await expect(
        controller.updateCurrentProfile(
          { firstName: 'Jane', lastName: 'Doe', language: 'en' },
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(UserNotFoundException);
    });
  });

  describe('getCurrentPreferences', () => {
    const preferencesResult = {
      userId: actor.userId,
      notificationOptIn: true,
      marketingOptIn: false,
      updatedAt: new Date('2026-07-15T12:00:00.000Z'),
    };

    it('delegates to the use case using only the JWT actor and maps the documented fields', async () => {
      getPreferencesExecute.mockResolvedValue(preferencesResult);

      const response = await controller.getCurrentPreferences(actor);

      expect(getPreferencesExecute).toHaveBeenCalledWith({ actor });
      expect(response).toEqual({
        userId: actor.userId,
        notificationOptIn: true,
        marketingOptIn: false,
        updatedAt: '2026-07-15T12:00:00.000Z',
      });
      // Never re-exposes User Profile or Authentication-internal fields.
      expect(response).not.toHaveProperty('language');
      expect(response).not.toHaveProperty('preferredCurrency');
      expect(response).not.toHaveProperty('passwordHash');
    });

    it('propagates UserNotFoundException from the use case unchanged', async () => {
      getPreferencesExecute.mockRejectedValue(new UserNotFoundException());

      await expect(controller.getCurrentPreferences(actor)).rejects.toBeInstanceOf(
        UserNotFoundException,
      );
    });
  });

  describe('updateCurrentPreferences', () => {
    function buildRequest(headers: Record<string, string> = {}): Request {
      return {
        ip: '203.0.113.44',
        socket: { remoteAddress: '127.0.0.1' },
        headers,
      } as unknown as Request;
    }

    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      updatePreferencesExecute.mockResolvedValue({
        userId: actor.userId,
        notificationOptIn: false,
        marketingOptIn: true,
        updatedAt: new Date('2026-07-15T12:00:00.000Z'),
      });

      const response = await controller.updateCurrentPreferences(
        { notificationOptIn: false, marketingOptIn: true },
        actor,
        buildRequest({ 'x-correlation-id': 'corr-pref-1' }),
      );

      expect(updatePreferencesExecute).toHaveBeenCalledWith({
        actor,
        notificationOptIn: false,
        marketingOptIn: true,
        ipAddress: '203.0.113.44',
        correlationId: 'corr-pref-1',
      });
      expect(response).toEqual({
        userId: actor.userId,
        notificationOptIn: false,
        marketingOptIn: true,
        updatedAt: '2026-07-15T12:00:00.000Z',
      });
    });

    it('propagates UserNotFoundException from the use case unchanged', async () => {
      updatePreferencesExecute.mockRejectedValue(new UserNotFoundException());

      await expect(
        controller.updateCurrentPreferences(
          { notificationOptIn: true, marketingOptIn: false },
          actor,
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(UserNotFoundException);
    });
  });

  describe('uploadAvatar', () => {
    function buildRequest(headers: Record<string, string> = {}): Request {
      return {
        ip: '203.0.113.44',
        socket: { remoteAddress: '127.0.0.1' },
        headers,
      } as unknown as Request;
    }

    const avatarResult = {
      avatarId: '44444444-4444-4444-8444-444444444444',
      avatarUrl: 'https://minio.example.com/tavla-public/avatars/foo.jpg?sig=abc',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      uploadedAt: new Date('2026-07-14T12:00:00.000Z'),
    };

    it('forwards the multer file and actor from the JWT, never a client-supplied id', async () => {
      uploadAvatarExecute.mockResolvedValue(avatarResult);
      const multerFile = {
        buffer: Buffer.from('fake-jpeg-bytes'),
        mimetype: 'image/jpeg',
        size: 1024,
      } as Express.Multer.File;

      const response = await controller.uploadAvatar(
        multerFile,
        actor,
        buildRequest({ 'x-correlation-id': 'corr-avatar-1' }),
      );

      expect(uploadAvatarExecute).toHaveBeenCalledWith({
        actor,
        file: { buffer: multerFile.buffer, mimeType: 'image/jpeg', sizeBytes: 1024 },
        ipAddress: '203.0.113.44',
        correlationId: 'corr-avatar-1',
      });
      expect(response).toEqual({
        avatarId: avatarResult.avatarId,
        avatarUrl: avatarResult.avatarUrl,
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        uploadedAt: '2026-07-14T12:00:00.000Z',
      });
    });

    it('forwards a null file to the use case when multer parsed none', async () => {
      uploadAvatarExecute.mockResolvedValue(avatarResult);

      await controller.uploadAvatar(undefined, actor, buildRequest());

      expect(uploadAvatarExecute).toHaveBeenCalledWith(expect.objectContaining({ file: null }));
    });

    it('propagates use-case exceptions unchanged', async () => {
      uploadAvatarExecute.mockRejectedValue(new UserNotFoundException());

      await expect(
        controller.uploadAvatar(undefined, actor, buildRequest()),
      ).rejects.toBeInstanceOf(UserNotFoundException);
    });
  });

  describe('addFavorite', () => {
    function buildRequest(headers: Record<string, string> = {}): Request {
      return {
        ip: '203.0.113.44',
        socket: { remoteAddress: '127.0.0.1' },
        headers,
      } as unknown as Request;
    }

    const restaurantId = '77777777-7777-4777-8777-777777777777';

    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      addFavoriteExecute.mockResolvedValue({
        restaurantId,
        favoritedAt: new Date('2026-07-14T12:00:00.000Z'),
      });

      const response = await controller.addFavorite(
        restaurantId,
        actor,
        buildRequest({ 'x-correlation-id': 'corr-fav-1' }),
      );

      expect(addFavoriteExecute).toHaveBeenCalledWith({
        actor,
        restaurantId,
        ipAddress: '203.0.113.44',
        correlationId: 'corr-fav-1',
      });
      expect(response).toEqual({
        restaurantId,
        favoritedAt: '2026-07-14T12:00:00.000Z',
      });
    });

    it('propagates RestaurantNotFoundException from the use case unchanged', async () => {
      addFavoriteExecute.mockRejectedValue(new RestaurantNotFoundException());

      await expect(
        controller.addFavorite(restaurantId, actor, buildRequest()),
      ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    });
  });

  describe('removeFavorite', () => {
    function buildRequest(headers: Record<string, string> = {}): Request {
      return {
        ip: '203.0.113.44',
        socket: { remoteAddress: '127.0.0.1' },
        headers,
      } as unknown as Request;
    }

    const restaurantId = '77777777-7777-4777-8777-777777777777';

    it('delegates to the use case with the actor from the JWT, never a client-supplied id', async () => {
      removeFavoriteExecute.mockResolvedValue(undefined);

      const response = await controller.removeFavorite(
        restaurantId,
        actor,
        buildRequest({ 'x-correlation-id': 'corr-fav-2' }),
      );

      expect(removeFavoriteExecute).toHaveBeenCalledWith({
        actor,
        restaurantId,
        ipAddress: '203.0.113.44',
        correlationId: 'corr-fav-2',
      });
      expect(response).toBeUndefined();
    });
  });

  describe('listFavorites', () => {
    it('delegates to the use case with the actor from the JWT and maps the documented fields', async () => {
      listFavoritesExecute.mockResolvedValue({
        items: [
          {
            restaurantId: '77777777-7777-4777-8777-777777777777',
            name: 'The Old Mill',
            slug: 'the-old-mill',
            cuisineType: 'Italian',
            priceLevel: 2,
            averageRating: 4.5,
            status: 'Active',
            favoritedAt: new Date('2026-07-14T12:00:00.000Z'),
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      });

      const response = await controller.listFavorites({ page: 2, limit: 10 }, actor);

      expect(listFavoritesExecute).toHaveBeenCalledWith({ actor, page: 2, limit: 10 });
      expect(response).toEqual({
        items: [
          {
            restaurantId: '77777777-7777-4777-8777-777777777777',
            name: 'The Old Mill',
            slug: 'the-old-mill',
            cuisineType: 'Italian',
            priceLevel: 2,
            averageRating: 4.5,
            status: 'Active',
            favoritedAt: '2026-07-14T12:00:00.000Z',
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      });
    });

    it('defaults page/limit to 1/20 when omitted', async () => {
      listFavoritesExecute.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 });

      await controller.listFavorites({}, actor);

      expect(listFavoritesExecute).toHaveBeenCalledWith({ actor, page: 1, limit: 20 });
    });
  });
});
