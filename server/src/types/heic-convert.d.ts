// Minimal types for heic-convert (no official types published). Pure-JS HEIC
// decoder used to transcode iPhone HEIC/HEIF uploads to a browser-safe JPEG.
declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: Buffer | Uint8Array | ArrayBufferLike;
    format: 'JPEG' | 'PNG';
    quality?: number; // 0..1, JPEG only
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>;
  export = convert;
}
