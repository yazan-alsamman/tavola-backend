import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/** Mirrors `PaginationQueryDto` exactly - the project-wide `page`/`limit`
 *  convention (owner decision #26). */
export class ListReviewsQueryDto extends PaginationQueryDto {}
