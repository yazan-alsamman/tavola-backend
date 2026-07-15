import { ConfigService } from '@nestjs/config';

const constructedClients: Array<{ endPoint: string; port: number; useSSL: boolean }> = [];
const presignedGetObject = jest.fn().mockResolvedValue('https://signed.example.com/object');

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation((options) => {
    constructedClients.push(options);
    return {
      putObject: jest.fn().mockResolvedValue(undefined),
      removeObject: jest.fn().mockResolvedValue(undefined),
      presignedGetObject,
    };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MinioFileStorageService } = require('./minio-file-storage.service');

describe('MinioFileStorageService', () => {
  beforeEach(() => {
    constructedClients.length = 0;
    presignedGetObject.mockClear();
  });

  function createService(overrides?: {
    signedUrlExpirySeconds?: number;
    publicEndpoint?: string;
    publicPort?: number;
    publicUseSSL?: boolean;
  }) {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        endpoint: 'minio-internal.local',
        port: 9000,
        useSSL: false,
        signedUrlExpirySeconds: overrides?.signedUrlExpirySeconds ?? 3600,
        accessKey: 'access-key',
        secretKey: 'secret-key',
        publicEndpoint: overrides?.publicEndpoint ?? 'minio-internal.local',
        publicPort: overrides?.publicPort ?? 9000,
        publicUseSSL: overrides?.publicUseSSL ?? false,
        region: 'us-east-1',
      }),
    } as unknown as ConfigService;

    // The injected client (constructor param) is a separate mock instance,
    // deliberately distinct from the internal presigningClient the service
    // constructs itself - proving the two are never conflated.
    const injectedClient = {
      putObject: jest.fn().mockResolvedValue(undefined),
      removeObject: jest.fn().mockResolvedValue(undefined),
      presignedGetObject: jest.fn(),
    };

    const service = new MinioFileStorageService(injectedClient, configService);
    return { service, injectedClient };
  }

  it('uploads with the declared Content-Type metadata via the injected client', async () => {
    const { service, injectedClient } = createService();
    const body = Buffer.from('fake-image-bytes');

    await service.upload({
      bucket: 'tavla-public',
      objectKey: 'avatars/u1/f1.jpg',
      body,
      contentType: 'image/jpeg',
      sizeBytes: body.length,
    });

    expect(injectedClient.putObject).toHaveBeenCalledWith(
      'tavla-public',
      'avatars/u1/f1.jpg',
      body,
      body.length,
      { 'Content-Type': 'image/jpeg' },
    );
  });

  it('deletes the exact bucket/objectKey pair given via the injected client', async () => {
    const { service, injectedClient } = createService();

    await service.delete('tavla-public', 'avatars/u1/f1.jpg');

    expect(injectedClient.removeObject).toHaveBeenCalledWith('tavla-public', 'avatars/u1/f1.jpg');
  });

  it('constructs a second client for presigning using the public endpoint, never the internal one', () => {
    createService({ publicEndpoint: 'cdn.example.com', publicPort: 443, publicUseSSL: true });

    expect(constructedClients).toHaveLength(1);
    expect(constructedClients[0]).toMatchObject({
      endPoint: 'cdn.example.com',
      port: 443,
      useSSL: true,
      region: 'us-east-1',
    });
  });

  it('falls back to the internal endpoint when no public override is configured', () => {
    createService({ publicEndpoint: 'minio-internal.local', publicPort: 9000 });

    expect(constructedClients[0]).toMatchObject({ endPoint: 'minio-internal.local', port: 9000 });
  });

  it('signs via the public-endpoint client, not the injected internal client', async () => {
    const { service, injectedClient } = createService();

    const url = await service.getSignedReadUrl('tavla-public', 'avatars/u1/f1.jpg');

    expect(url).toBe('https://signed.example.com/object');
    expect(presignedGetObject).toHaveBeenCalledWith('tavla-public', 'avatars/u1/f1.jpg', 3600);
    expect(injectedClient.presignedGetObject).not.toHaveBeenCalled();
  });

  it('uses the configured default expiry when none is given', async () => {
    const { service } = createService({ signedUrlExpirySeconds: 900 });

    await service.getSignedReadUrl('tavla-public', 'avatars/u1/f1.jpg');

    expect(presignedGetObject).toHaveBeenCalledWith('tavla-public', 'avatars/u1/f1.jpg', 900);
  });

  it('uses an explicit expiry override when given', async () => {
    const { service } = createService({ signedUrlExpirySeconds: 900 });

    await service.getSignedReadUrl('tavla-public', 'avatars/u1/f1.jpg', 60);

    expect(presignedGetObject).toHaveBeenCalledWith('tavla-public', 'avatars/u1/f1.jpg', 60);
  });
});
