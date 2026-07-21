import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';

export class EmployeeResponseDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid' })
  roleId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Set only after first-login linking (AUTHENTICATION_ARCHITECTURE.md §1.2).',
  })
  userId!: string | null;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  lastName!: string;

  @ApiProperty({ example: 'jane.doe@example.com' })
  email!: string;

  @ApiPropertyOptional({ example: '+963900000000', nullable: true })
  phone!: string | null;

  @ApiProperty({
    enum: EmployeeStatus,
    description: '`Invited` until first-login linking; `Deactivated` is unused by Phase 7.0.',
  })
  status!: EmployeeStatus;

  @ApiProperty({
    type: [String],
    description: 'Empty array means restaurant-wide scope, not "no access".',
  })
  assignedBranchIds!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
