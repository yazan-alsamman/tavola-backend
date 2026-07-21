import { StoragePort, UploadObjectInput } from '@modules/files/application/ports/storage.port';

export class FakeStoragePort implements StoragePort {
  readonly uploaded: UploadObjectInput[] = [];
  readonly deleted: Array<{ bucket: string; objectKey: string }> = [];
  uploadShouldFail = false;
  deleteShouldFail = false;

  async upload(input: UploadObjectInput): Promise<void> {
    if (this.uploadShouldFail) {
      throw new Error('storage unreachable');
    }
    this.uploaded.push(input);
  }

  async delete(bucket: string, objectKey: string): Promise<void> {
    if (this.deleteShouldFail) {
      throw new Error('delete failed');
    }
    this.deleted.push({ bucket, objectKey });
  }

  async getSignedReadUrl(bucket: string, objectKey: string): Promise<string> {
    return `https://signed.example.com/${bucket}/${objectKey}`;
  }
}
