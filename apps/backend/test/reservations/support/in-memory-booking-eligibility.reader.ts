import { BookingEligibilityReaderPort } from '@modules/reservations/application/ports/booking-eligibility-reader.port';

export class InMemoryBookingEligibilityReader implements BookingEligibilityReaderPort {
  acceptingReservations = true;
  upcomingActiveCount = 0;

  async isRestaurantAcceptingReservations(): Promise<boolean> {
    return this.acceptingReservations;
  }

  async countUpcomingActiveForUser(): Promise<number> {
    return this.upcomingActiveCount;
  }
}
