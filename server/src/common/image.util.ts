import convert from 'heic-convert';

export type WebSafeExt = 'jpg' | 'png' | 'webp';

/**
 * Detect a raster image's real format from its leading bytes (magic numbers),
 * NOT the client-supplied mimetype/extension — browsers happily report a
 * HEIC/HEIF photo (e.g. straight off an iPhone) as `image/jpeg`.
 */
export function detectImageKind(buf: Buffer): WebSafeExt | 'heic' | null {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';

  // HEIF family (HEIC/HEIF): an ISO-BMFF box where bytes 4..8 are "ftyp" and the
  // major brand at 8..12 is one of the HEIF brands.
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)) {
      return 'heic';
    }
  }

  return null;
}

/**
 * Normalize an uploaded image to something every browser can render. JPEG/PNG/
 * WebP pass through untouched; HEIC/HEIF is transcoded to JPEG. Returns null for
 * anything that isn't a supported image (so the caller can 400).
 */
export async function toWebSafeImage(buf: Buffer): Promise<{ buffer: Buffer; ext: WebSafeExt } | null> {
  const kind = detectImageKind(buf);
  if (kind === 'jpg' || kind === 'png' || kind === 'webp') return { buffer: buf, ext: kind };
  if (kind === 'heic') {
    const out = await convert({ buffer: buf, format: 'JPEG', quality: 0.9 });
    return { buffer: Buffer.from(out), ext: 'jpg' };
  }
  return null;
}

const MIME: Record<WebSafeExt, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export function mimeForExt(ext: WebSafeExt): string {
  return MIME[ext];
}

/** Human-facing reason shown when toWebSafeImage returns null. */
export const UNSUPPORTED_IMAGE_MESSAGE = 'Only image files (JPG, PNG, WebP or HEIC) are supported.';
