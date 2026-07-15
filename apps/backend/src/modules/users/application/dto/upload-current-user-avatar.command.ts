import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Framework-neutral file shape - deliberately not Express.Multer.File, so
 * the application layer never depends on Express/multer (DOMAIN_MODEL.md's
 * framework-independence rule extends to the boundary the controller maps
 * across, not just the domain layer itself).
 */
export interface UploadedAvatarFile {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadCurrentUserAvatarCommand {
  actor: AuthenticatedActor;
  file: UploadedAvatarFile | null;
  ipAddress: string;
  correlationId?: string;
}
