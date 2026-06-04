import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawFigmaNode } from '../src/figma/api.js';
import { normalizeTree, resolveColor } from '../src/figma/normalizer.js';

const fixture: RawFigmaNode = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'raw-frame.json'), 'utf8'),
);

describe('resolveColor', () => {
  it('converts 0..1 float channels to 0..255 + hex', () => {
    expect(resolveColor({ r: 1, g: 1, b: 1, a: 1 })).toEqual({
      hex: '#FFFFFF',
      rgba: { r: 255, g: 255, b: 255, a: 1 },
    });
  });

  it('rounds channels and defaults alpha to 1', () => {
    const color = resolveColor({ r: 0.17647058823529413, g: 0.4235294117647059, b: 0.8745098039215686 });
    expect(color).toEqual({ hex: '#2D6CDF', rgba: { r: 45, g: 108, b: 223, a: 1 } });
  });

  it('returns undefined for malformed input', () => {
    expect(resolveColor(null)).toBeUndefined();
    expect(resolveColor({ r: 'x' })).toBeUndefined();
  });
});

describe('normalizeTree', () => {
  const tree = normalizeTree(fixture);

  it('preserves identity and bbox', () => {
    expect(tree.id).toBe('12:345');
    expect(tree.name).toBe('Checkout / Desktop');
    expect(tree.type).toBe('FRAME');
    expect(tree.bbox).toEqual({ x: 100, y: 200, width: 1440, height: 900 });
  });

  it('defaults visible=true and opacity=1 when Figma omits them', () => {
    expect(tree.visible).toBe(true);
    expect(tree.opacity).toBe(1);
  });

  it('keeps explicit visible=false and opacity', () => {
    const decorative = tree.children[2];
    expect(decorative.visible).toBe(false);
    expect(decorative.opacity).toBe(0.5);
  });

  it('maps auto-layout to direction/spacing/padding', () => {
    expect(tree.autoLayout).toEqual({
      direction: 'VERTICAL',
      itemSpacing: 24,
      paddingTop: 32,
      paddingRight: 48,
      paddingBottom: 32,
      paddingLeft: 48,
      primaryAxisAlign: 'MIN',
      counterAxisAlign: 'CENTER',
    });
  });

  it('extracts text content and typography from TEXT nodes', () => {
    const heading = tree.children[0];
    expect(heading.text).toBe('Checkout');
    expect(heading.typography).toEqual({
      fontFamily: 'Inter',
      fontSize: 32,
      fontWeight: 700,
      lineHeightPx: 40,
      letterSpacing: -0.5,
      textAlignHorizontal: 'LEFT',
    });
    expect(heading.fills[0].color?.hex).toBe('#1A1A2E');
  });

  it('resolves solid fills to hex', () => {
    const button = tree.children[1];
    expect(button.fills).toHaveLength(1);
    expect(button.fills[0]).toMatchObject({
      type: 'SOLID',
      visible: true,
      color: { hex: '#2D6CDF' },
    });
  });

  it('keeps invisible strokes but flags them', () => {
    const button = tree.children[1];
    expect(button.strokes).toHaveLength(1);
    expect(button.strokes[0].visible).toBe(false);
    expect(button.strokeWeight).toBe(1);
  });

  it('extracts variant properties from instances, stripping internal id suffixes', () => {
    const button = tree.children[1];
    expect(button.variant).toEqual({ State: 'Default', Size: 'Large' });
  });

  it('collapses uniform per-corner radii and keeps non-uniform as a tuple', () => {
    const button = tree.children[1];
    const decorative = tree.children[2];
    expect(button.cornerRadius).toBe(8);
    expect(decorative.cornerRadius).toEqual([4, 4, 0, 0]);
  });

  it('normalizes gradient paints with resolved stop colors', () => {
    const decorative = tree.children[2];
    expect(decorative.fills[0].type).toBe('GRADIENT');
    expect(decorative.fills[0].gradientStops).toEqual([
      { position: 0, color: { hex: '#FF0000', rgba: { r: 255, g: 0, b: 0, a: 1 } } },
      { position: 1, color: { hex: '#0000FF', rgba: { r: 0, g: 0, b: 255, a: 0.5 } } },
    ]);
  });

  it('recurses into children', () => {
    const label = tree.children[1].children[0];
    expect(label.text).toBe('Place order');
    expect(label.typography?.fontWeight).toBe(600);
  });

  it('produces empty arrays, not undefined, for missing fills/strokes/children', () => {
    const minimal = normalizeTree({ id: '1:1', name: 'x', type: 'RECTANGLE' });
    expect(minimal.fills).toEqual([]);
    expect(minimal.strokes).toEqual([]);
    expect(minimal.children).toEqual([]);
    expect(minimal.bbox).toBeNull();
  });
});
