import { detectImageMimeType } from './image-signature.detector';

function bytes(...values: number[]): Buffer {
  return Buffer.from(values);
}

describe('detectImageMimeType', () => {
  it('detects a JPEG signature', () => {
    const buffer = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(16, 0)]);
    expect(detectImageMimeType(buffer)).toBe('image/jpeg');
  });

  it('detects a PNG signature', () => {
    const buffer = Buffer.concat([
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      Buffer.alloc(16, 0),
    ]);
    expect(detectImageMimeType(buffer)).toBe('image/png');
  });

  it('detects a WebP signature (RIFF....WEBP)', () => {
    const buffer = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      bytes(0x00, 0x00, 0x00, 0x00),
      Buffer.from('WEBP', 'ascii'),
      Buffer.alloc(8, 0),
    ]);
    expect(detectImageMimeType(buffer)).toBe('image/webp');
  });

  it('returns null for a GIF signature (unsupported format)', () => {
    const buffer = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(16, 0)]);
    expect(detectImageMimeType(buffer)).toBeNull();
  });

  it('returns null for arbitrary text/HTML content spoofing an image extension', () => {
    const buffer = Buffer.from('<html><body>not an image</body></html>', 'utf8');
    expect(detectImageMimeType(buffer)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a truncated signature shorter than the magic bytes', () => {
    expect(detectImageMimeType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageMimeType(bytes(0x89, 0x50, 0x4e))).toBeNull();
  });
});
