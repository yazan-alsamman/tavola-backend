import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class TransferOrganizationOwnershipRequestDto {
  @ApiProperty({
    format: 'uuid',
    description: 'userId of the existing Active member to make Owner',
  })
  @IsUUID()
  @IsNotEmpty()
  newOwnerUserId!: string;
}
