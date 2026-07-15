/**
 * Object-storage capability port (application layer, mirrors ClockPort /
 * AuditLogWriterPort under shared/application/ports) - the sole abstraction
 * over MinIO. No adapter outside modules/files/infrastructure may talk to
 * MinIO directly (StorageModule only wires the raw client; this port is the
 * "FileStorageService" it defers to per its own doc-comment).
 */
export interface UploadObjectInput {
  bucket: string;
  objectKey: string;
  body: Buffer;
  contentType: string;
  sizeBytes: number;
}

export interface StoragePort {
  upload(input: UploadObjectInput): Promise<void>;
  delete(bucket: string, objectKey: string): Promise<void>;
  getSignedReadUrl(bucket: string, objectKey: string, expirySeconds?: number): Promise<string>;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
