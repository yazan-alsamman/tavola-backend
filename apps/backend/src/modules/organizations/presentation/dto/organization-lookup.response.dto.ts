import { ApiProperty } from '@nestjs/swagger';

export class OrganizationLookupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ nullable: true })
  deletedAt!: string | null;
}

export class OrganizationLookupListResponseDto {
  @ApiProperty({ type: [OrganizationLookupResponseDto] })
  items!: OrganizationLookupResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
