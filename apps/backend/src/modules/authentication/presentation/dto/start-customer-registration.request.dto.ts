import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { PhoneIdentifierRequestDto } from './phone-identifier.request.dto';

/**
 * Transport-only shape check (ADR-022 §"REGISTER — START"). Actual
 * validation/normalization to canonical E.164 happens via the
 * `PhoneNumber` value object in the use case, not here.
 */
export class StartCustomerRegistrationRequestDto extends PhoneIdentifierRequestDto {
  @ApiProperty({ example: 'jane_doe', minLength: 3, maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(30)
  username!: string;
}
