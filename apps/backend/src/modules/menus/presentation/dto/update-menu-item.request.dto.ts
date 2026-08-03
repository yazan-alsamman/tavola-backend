import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MenuItemAvailabilityMode } from '../../domain/enums/menu-item.enums';
import { CreateMenuItemRequestDto } from './create-menu-item.request.dto';

export class UpdateMenuItemRequestDto extends CreateMenuItemRequestDto {
  @ApiProperty({ enum: MenuItemAvailabilityMode, example: MenuItemAvailabilityMode.Always })
  @IsEnum(MenuItemAvailabilityMode)
  availabilityMode!: MenuItemAvailabilityMode;
}
