import { CustomerAcquisition } from './customer-acquisition.entity';
import { AcquisitionCreatedVia, AcquisitionStatus } from '../enums/customer-acquisition.enums';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { AcquisitionAlreadyReversedException } from '../exceptions/acquisition-already-reversed.exception';
import { InvalidCustomerAcquisitionException } from '../exceptions/invalid-customer-acquisition.exception';

const baseAutomaticProps = {
  id: '11111111-1111-4111-8111-111111111111',
  restaurantId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  reservationGuestId: null,
  sourceReservationId: '44444444-4444-4444-8444-444444444444',
  reservationSource: ReservationSource.Online,
  feeAmount: 1000,
  feeCurrency: 'SYP',
  pricingRuleId: '55555555-5555-4555-8555-555555555555',
  now: new Date('2026-08-09T12:00:00.000Z'),
};

describe('CustomerAcquisition', () => {
  describe('recordAutomatic', () => {
    it('creates a Recorded, Automatic acquisition snapshotting the fee', () => {
      const acquisition = CustomerAcquisition.recordAutomatic(baseAutomaticProps);

      expect(acquisition.status).toBe(AcquisitionStatus.Recorded);
      expect(acquisition.createdVia).toBe(AcquisitionCreatedVia.Automatic);
      expect(acquisition.feeAmount).toBe(1000);
      expect(acquisition.feeCurrency).toBe('SYP');
      expect(acquisition.reversedAt).toBeNull();
      expect(acquisition.customerIdentityKey()).toBe(baseAutomaticProps.userId);
    });

    it('rejects both userId and reservationGuestId set (party XOR violation)', () => {
      expect(() =>
        CustomerAcquisition.recordAutomatic({
          ...baseAutomaticProps,
          reservationGuestId: '66666666-6666-4666-8666-666666666666',
        }),
      ).toThrow(InvalidCustomerAcquisitionException);
    });

    it('rejects neither userId nor reservationGuestId set', () => {
      expect(() =>
        CustomerAcquisition.recordAutomatic({ ...baseAutomaticProps, userId: null }),
      ).toThrow(InvalidCustomerAcquisitionException);
    });

    it('rejects a negative feeAmount', () => {
      expect(() =>
        CustomerAcquisition.recordAutomatic({ ...baseAutomaticProps, feeAmount: -1 }),
      ).toThrow(InvalidCustomerAcquisitionException);
    });

    it('resolves customerIdentityKey to reservationGuestId when userId is null', () => {
      const acquisition = CustomerAcquisition.recordAutomatic({
        ...baseAutomaticProps,
        userId: null,
        reservationGuestId: '77777777-7777-4777-8777-777777777777',
      });
      expect(acquisition.customerIdentityKey()).toBe('77777777-7777-4777-8777-777777777777');
    });
  });

  describe('recordManual', () => {
    it('creates a Recorded, ManualPlatformAdminCorrection acquisition with no sourceReservationId', () => {
      const acquisition = CustomerAcquisition.recordManual({
        id: baseAutomaticProps.id,
        restaurantId: baseAutomaticProps.restaurantId,
        userId: baseAutomaticProps.userId,
        reservationGuestId: null,
        feeAmount: 1000,
        feeCurrency: 'SYP',
        pricingRuleId: baseAutomaticProps.pricingRuleId,
        now: baseAutomaticProps.now,
      });

      expect(acquisition.createdVia).toBe(AcquisitionCreatedVia.ManualPlatformAdminCorrection);
      expect(acquisition.sourceReservationId).toBeNull();
      expect(acquisition.reservationSource).toBeNull();
    });
  });

  describe('reverse', () => {
    it('transitions Recorded -> Reversed and records reason/actor/timestamp', () => {
      const acquisition = CustomerAcquisition.recordAutomatic(baseAutomaticProps);
      const at = new Date('2026-08-10T00:00:00.000Z');

      const reversed = acquisition.reverse(
        '88888888-8888-4888-8888-888888888888',
        'Duplicate approval',
        at,
      );

      expect(reversed.status).toBe(AcquisitionStatus.Reversed);
      expect(reversed.reversedBy).toBe('88888888-8888-4888-8888-888888888888');
      expect(reversed.reversalReason).toBe('Duplicate approval');
      expect(reversed.reversedAt).toEqual(at);
    });

    it('rejects reversing an already-Reversed acquisition', () => {
      const acquisition = CustomerAcquisition.recordAutomatic(baseAutomaticProps);
      const reversed = acquisition.reverse('actor', 'reason', new Date());

      expect(() => reversed.reverse('actor', 'reason again', new Date())).toThrow(
        AcquisitionAlreadyReversedException,
      );
    });

    it('rejects an empty reversalReason', () => {
      const acquisition = CustomerAcquisition.recordAutomatic(baseAutomaticProps);
      expect(() => acquisition.reverse('actor', '   ', new Date())).toThrow(
        InvalidCustomerAcquisitionException,
      );
    });
  });
});
