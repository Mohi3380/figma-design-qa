import { describe, expect, it } from 'vitest';
import { FigmaUrlError, normalizeNodeId, parseFigmaUrl } from '../src/figma/url.js';

describe('parseFigmaUrl', () => {
  it('parses a modern design URL with node-id', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/AbC123/Checkout?node-id=12-345&t=xyz'),
    ).toEqual({ fileKey: 'AbC123', nodeId: '12:345' });
  });

  it('parses a legacy file URL', () => {
    expect(parseFigmaUrl('https://www.figma.com/file/AbC123/Checkout?node-id=12-345')).toEqual({
      fileKey: 'AbC123',
      nodeId: '12:345',
    });
  });

  it('parses a URL without node-id (whole file)', () => {
    expect(parseFigmaUrl('https://figma.com/design/AbC123/Checkout')).toEqual({ fileKey: 'AbC123' });
  });

  it('uses the branch key for branch URLs', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/AbC123/branch/BrK456/Checkout?node-id=1-2'),
    ).toEqual({ fileKey: 'BrK456', nodeId: '1:2' });
  });

  it('rejects non-figma URLs', () => {
    expect(() => parseFigmaUrl('https://example.com/design/AbC123/x')).toThrow(FigmaUrlError);
    expect(() => parseFigmaUrl('https://evilfigma.com/design/AbC123/x')).toThrow(FigmaUrlError);
  });

  it('rejects unrecognized figma paths', () => {
    expect(() => parseFigmaUrl('https://www.figma.com/community/plugin/123')).toThrow(FigmaUrlError);
  });

  it('rejects garbage input', () => {
    expect(() => parseFigmaUrl('not a url')).toThrow(FigmaUrlError);
  });
});

describe('normalizeNodeId', () => {
  it('converts URL form to API form', () => {
    expect(normalizeNodeId('12-345')).toBe('12:345');
  });

  it('passes API form through unchanged', () => {
    expect(normalizeNodeId('12:345')).toBe('12:345');
  });
});
