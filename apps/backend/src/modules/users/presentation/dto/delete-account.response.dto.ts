import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountResponseDto {
  @ApiProperty({
    description:
      'When this account will be irreversibly anonymized if the request is not cancelled first (ADR-014 grace period).',
    example: '2026-09-06T12:00:00.000Z',
  })
  scheduledAnonymizationAt!: string;
}
