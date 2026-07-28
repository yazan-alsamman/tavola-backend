import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface UploadedReviewImageFile {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface AddReviewImageCommand {
  actor: AuthenticatedActor;
  reviewId: string;
  file: UploadedReviewImageFile | null;
  correlationId?: string;
}
