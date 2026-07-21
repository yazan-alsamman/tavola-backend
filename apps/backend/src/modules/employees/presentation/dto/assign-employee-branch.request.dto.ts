import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignEmployeeBranchRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Must belong to the same restaurant.' })
  @IsUUID()
  branchId!: string;
}
