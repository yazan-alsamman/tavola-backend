import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Multipart request: the image file itself is handled via
 * `FileInterceptor`/`@UploadedFile()`, not this DTO (mirrors
 * `UsersController.uploadAvatar`'s exact pattern) - this DTO only covers the
 * accompanying form field(s).
 */
export class AddRestaurantGalleryImageRequestDto {
  @ApiPropertyOptional({ example: 'Our dining room' })
  @IsOptional()
  @IsString()
  caption?: string;
}
