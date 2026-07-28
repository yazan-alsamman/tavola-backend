/** Result of adding a single image to a Review (distinct shape from the
 *  embedded `ReviewImageResult` in `review.result.ts`, which is deliberately
 *  minimal for list/get contexts). */
export interface ReviewImageUploadResult {
  reviewImageId: string;
  reviewId: string;
  sortOrder: number;
  imageUrl: string;
  createdAt: Date;
}
