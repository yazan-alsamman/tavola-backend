import { ApiProperty } from '@nestjs/swagger';

export class NotificationSendResponseDto {
  @ApiProperty({ format: 'uuid' })
  notificationId!: string;
}
