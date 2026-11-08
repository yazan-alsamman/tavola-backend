import { createGlobalValidationPipe } from '@common/pipes/validation-pipe.factory';
import { ListFavoritesQueryDto } from './list-favorites.query.dto';

describe('ListFavoritesQueryDto', () => {
  const pipe = createGlobalValidationPipe();
  const validate = (query: Record<string, string>) =>
    pipe.transform(query, { type: 'query', metatype: ListFavoritesQueryDto });

  it('accepts the published app query (page + pageSize) instead of rejecting it', async () => {
    const dto = (await validate({ page: '1', pageSize: '20' })) as ListFavoritesQueryDto;
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
  });

  it('still accepts the documented page + limit query', async () => {
    const dto = (await validate({ page: '2', limit: '50' })) as ListFavoritesQueryDto;
    expect(dto.limit).toBe(50);
    expect(dto.pageSize).toBeUndefined();
  });

  it('still rejects an unknown query field', async () => {
    await expect(validate({ page: '1', size: '20' })).rejects.toThrow();
  });

  it('rejects an out-of-range pageSize', async () => {
    await expect(validate({ pageSize: '500' })).rejects.toBeInstanceOf(Error);
  });
});
