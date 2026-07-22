import { ApiProperty } from '@nestjs/swagger';

/** Shared response shape for every OTP send/resend/verify step - never includes the OTP itself. */
export class CustomerOtpResponseDto {
  @ApiProperty({ example: 'If the phone number is valid, a verification code has been sent.' })
  message!: string;
}
