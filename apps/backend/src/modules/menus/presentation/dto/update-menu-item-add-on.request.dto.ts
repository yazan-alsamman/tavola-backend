import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CreateMenuItemAddOnRequestDto } from './create-menu-item-add-on.request.dto';

export class UpdateMenuItemAddOnRequestDto extends CreateMenuItemAddOnRequestDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  active!: boolean;
}
