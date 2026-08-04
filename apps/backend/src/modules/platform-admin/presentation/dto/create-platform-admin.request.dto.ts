import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

/** ADR-034 §10 - mirrors `ProvisionRestaurantOwnerRequestDto`'s trust model (final password, no OTP). */
export class CreatePlatformAdminRequestDto {
  @ApiProperty({ example: 'support@tavla.internal' })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 12 })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ enum: PlatformAdminRole, example: PlatformAdminRole.PlatformSupport })
  @IsEnum(PlatformAdminRole)
  role!: PlatformAdminRole;
}
