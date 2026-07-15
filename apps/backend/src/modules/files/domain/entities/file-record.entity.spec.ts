import { FileRecord } from './file-record.entity';

describe('FileRecord', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: '22222222-2222-4222-8222-222222222222',
    ownerType: 'User' as const,
    bucket: 'tavla-public',
    objectKey: 'avatars/22222222-2222-4222-8222-222222222222/file.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    accessPolicy: 'Public' as const,
    createdAt: new Date('2026-07-14T12:00:00.000Z'),
    deletedAt: null,
  };

  it('creates a valid record', () => {
    const record = FileRecord.create(baseProps);
    expect(record.fileId.value).toBe(baseProps.id);
    expect(record.ownerId).toBe(baseProps.ownerId);
    expect(record.bucket).toBe(baseProps.bucket);
    expect(record.objectKey).toBe(baseProps.objectKey);
    expect(record.isDeleted()).toBe(false);
  });

  it('rejects an empty ownerId', () => {
    expect(() => FileRecord.create({ ...baseProps, ownerId: '  ' })).toThrow();
  });

  it('rejects an empty objectKey', () => {
    expect(() => FileRecord.create({ ...baseProps, objectKey: '' })).toThrow();
  });

  it('rejects a non-positive sizeBytes', () => {
    expect(() => FileRecord.create({ ...baseProps, sizeBytes: 0 })).toThrow();
    expect(() => FileRecord.create({ ...baseProps, sizeBytes: -5 })).toThrow();
  });

  it('softDelete sets deletedAt and leaves other fields untouched', () => {
    const record = FileRecord.create(baseProps);
    const at = new Date('2026-07-15T00:00:00.000Z');

    const deleted = record.softDelete(at);

    expect(deleted.isDeleted()).toBe(true);
    expect(deleted.deletedAt).toEqual(at);
    expect(deleted.objectKey).toBe(baseProps.objectKey);
    expect(record.isDeleted()).toBe(false); // original instance is unchanged
  });

  it('toProps returns a plain snapshot matching the constructed props', () => {
    const record = FileRecord.create(baseProps);
    expect(record.toProps()).toEqual(baseProps);
  });
});
