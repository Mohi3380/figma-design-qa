/**
 * Detect a raster image's real format from its leading bytes (magic numbers),
 * NOT the client-supplied mimetype/extension — browsers happily report a
 * HEIC/HEIF photo (e.g. straight off an iPhone) as `image/jpeg`, and HEIC does
 * not render in any browser. Returns the canonical extension we support, or
 * null for anything we can't safely display.
 */
export function detectImageExt(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
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

  return null;
}

/** Human-facing reason shown when detectImageExt returns null. */
export const UNSUPPORTED_IMAGE_MESSAGE =
  'Only JPG, PNG, or WebP images are supported. HEIC/HEIF photos (e.g. from an iPhone) don’t display in browsers — re-export as JPG or PNG and try again.';
