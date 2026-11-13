import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * Branch cover images (ADR-051). The cover upload stays one use case in this
 * module, so it reaches the branch row through this narrow port instead of
 * depending on BranchesModule, which already depends on this module.
 * Passthrough like the gallery: callers resolve the restaurant first.
 */
export interface BranchCoverImageRepository {
  /** The branch's current cover file id, or undefined when it is not a live branch of the restaurant. */
  findCoverImageId(
    restaurantId: RestaurantId,
    branchId: string,
  ): Promise<string | null | undefined>;
  assignCoverImage(branchId: string, fileId: string, at: Date): Promise<void>;
  /**
   * How many restaurant covers/logos and branch covers still point at the file.
   * The data migration lets branches share the restaurant's cover file, so a
   * replaced file is only deleted once nothing references it.
   */
  countCoverReferences(fileId: string): Promise<number>;
}

export const BRANCH_COVER_IMAGE_REPOSITORY = Symbol('BRANCH_COVER_IMAGE_REPOSITORY');
