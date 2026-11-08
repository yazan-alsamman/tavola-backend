import { ApiProperty } from '@nestjs/swagger';

export class RoleResponseDto {
  @ApiProperty({ format: 'uuid' })
  roleId!: string;

  @ApiProperty({ example: 'Restaurant Manager' })
  name!: string;

  @ApiProperty({ example: 'restaurant-manager' })
  slug!: string;

  @ApiProperty()
  description!: string;
}

export class RoleListResponseDto {
  @ApiProperty({ type: [RoleResponseDto] })
  items!: RoleResponseDto[];
}
