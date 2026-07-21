import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * Framework-neutral file shape - deliberately not Express.Multer.File, so
 * the application layer never depends on Express/multer. Mirrors
 * `UploadedAvatarFile` exactly.
 */
export interface UploadedGalleryImageFile {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface AddRestaurantGalleryImageCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  file: UploadedGalleryImageFile | null;
  caption: string | null;
  correlationId?: string;
}
