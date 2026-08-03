import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CreateMenuItemOptionRequestDto } from './create-menu-item-option.request.dto';

export class UpdateMenuItemOptionRequestDto extends CreateMenuItemOptionRequestDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  active!: boolean;
}
