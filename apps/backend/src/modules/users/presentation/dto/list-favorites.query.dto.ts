import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/** Mirrors API_GUIDELINES.md's Pagination section (`page`/`limit`) via the
 *  shared `PaginationQueryDto` base - see that file for the rationale. */
export class ListFavoritesQueryDto extends PaginationQueryDto {}
