import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignEmployeeRoleRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Must be a Restaurant-scope Role.' })
  @IsUUID()
  roleId!: string;
}
