import { Injectable } from '@nestjs/common';
import { ConsentType as PrismaConsentType } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { UserConsent } from '../../domain/entities/user-consent.entity';
import { UserConsentRepository } from '../../domain/repositories/user-consent.repository';

@Injectable()
export class PrismaUserConsentRepository implements UserConsentRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async saveMany(consents: UserConsent[]): Promise<void> {
    if (consents.length === 0) {
      return;
    }

    await this.prismaContext.client.userConsent.createMany({
      data: consents.map((consent) => {
        const props = consent.toProps();
        return {
          id: props.id,
          userId: props.userId,
          consentType: props.consentType as PrismaConsentType,
          termsVersion: props.termsVersion,
          consentedAt: props.consentedAt,
          ipAddress: props.ipAddress,
        };
      }),
    });
  }
}
