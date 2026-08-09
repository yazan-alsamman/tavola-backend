import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import {
  ReservationStatus,
  ReservationSource,
} from '@modules/reservations/domain/enums/reservation.enums';

export const FIXED_NOW = new Date('2026-07-26T12:00:00.000Z');

export function testUser(overrides: { id: string; username?: string | null }): User {
  return User.reconstitute({
    id: overrides.id,
    firstName: null,
    lastName: null,
    email: null,
    phone: '+15550000000',
    username: overrides.username ?? 'test_user',
    passwordHash: 'hash',
    language: 'en',
    preferredCurrency: null,
    notificationOptIn: true,
    marketingOptIn: false,
    status: UserStatus.Active,
    emailVerified: false,
    failedLoginCount: 0,
    lockedUntil: null,
    permissionsVersion: 1,
    sessionVersion: 1,
    passwordChangedAt: null,
    lastLoginAt: null,
    anonymizedAt: null,
    deletionRequestedAt: null,
    scheduledAnonymizationAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    deletedAt: null,
  });
}

export function testRestaurant(overrides: { id: string; organizationId: string }): Restaurant {
  return Restaurant.create({
    id: overrides.id,
    organizationId: overrides.organizationId,
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: null,
    averageRating: null,
    priceLevel: null,
    status: RestaurantStatus.Active,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    deletedAt: null,
  });
}

function testReservation(overrides: {
  id: string;
  userId: string | null;
  reservationGuestId?: string | null;
  restaurantId: string;
  branchId: string;
  tableId: string;
  status: ReservationStatus;
}): Reservation {
  return Reservation.reconstitute({
    id: overrides.id,
    userId: overrides.userId,
    reservationGuestId: overrides.reservationGuestId ?? null,
    restaurantId: overrides.restaurantId,
    branchId: overrides.branchId,
    tableId: overrides.tableId,
    reservationDate: new Date('2026-07-20T00:00:00.000Z'),
    reservationStartTime: new Date('2026-07-20T18:00:00.000Z'),
    reservationEndTime: new Date('2026-07-20T20:00:00.000Z'),
    guests: 2,
    status: overrides.status,
    source: ReservationSource.Online,
    notes: null,
    createdBy: overrides.userId,
    approvedBy: null,
    approvedAt: null,
    cancelledAt: null,
    completedAt: overrides.status === ReservationStatus.Completed ? FIXED_NOW : null,
    noShowAt: null,
    lateArrivalNotifiedAt: null,
    tableReadyNotifiedAt: null,
    rescheduledFromReservationId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

export function testCompletedReservation(overrides: {
  id: string;
  userId: string | null;
  reservationGuestId?: string | null;
  restaurantId: string;
  branchId: string;
  tableId: string;
}): Reservation {
  return testReservation({ ...overrides, status: ReservationStatus.Completed });
}

export function testPendingReservation(overrides: {
  id: string;
  userId: string | null;
  reservationGuestId?: string | null;
  restaurantId: string;
  branchId: string;
  tableId: string;
}): Reservation {
  return testReservation({ ...overrides, status: ReservationStatus.Pending });
}
