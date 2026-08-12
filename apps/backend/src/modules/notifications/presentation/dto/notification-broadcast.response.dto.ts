import { ApiProperty } from '@nestjs/swagger';

export class NotificationBroadcastResponseDto {
  @ApiProperty({ format: 'uuid' })
  broadcastId!: string;

  @ApiProperty({
    description:
      'Point-in-time audience-size snapshot resolved at request time - observability only, not a strict delivery guarantee (the eligible audience can shift while the broadcast is still processing).',
  })
  totalRecipients!: number;
}
