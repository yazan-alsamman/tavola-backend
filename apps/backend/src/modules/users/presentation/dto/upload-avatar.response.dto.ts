import { ApiProperty } from '@nestjs/swagger';

export class UploadAvatarResponseDto {
  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  avatarId!: string;

  @ApiProperty({
    example: 'https://minio.example.com/tavla-public/avatars/.../avatar.jpg?X-Amz-...',
    description: 'A freshly-generated, time-limited signed URL - never cache this value long-term.',
  })
  avatarUrl!: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType!: string;

  @ApiProperty({ example: 102400 })
  sizeBytes!: number;

  @ApiProperty({ example: '2026-07-14T12:00:00.000Z' })
  uploadedAt!: string;
}
