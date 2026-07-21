import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { TableStatus } from '@modules/tables/domain/enums/table.enums';

export class ChangeTableStatusRequestDto {
  @ApiProperty({
    enum: TableStatus,
    description:
      'Target status. Only Available <-> Occupied, Available <-> Cleaning, and Available <-> Disabled transitions are allowed (Status Management architecture decision) - every other combination, including a same-status "transition", is rejected.',
  })
  @IsEnum(TableStatus)
  status!: TableStatus;
}
