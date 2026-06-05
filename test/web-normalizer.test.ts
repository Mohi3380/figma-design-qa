import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  firstFontFamily,
  normalizeDomTree,
  parseCssColor,
  parseFontWeight,
} from '../src/web/normalizer.js';
import type { RawDomNode } from '../src/web/snapshot.js';

const fixture: RawDomNode = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'raw-dom.json'), 'utf8'),
);

describe('parseCssColor', () => {
  it('parses rgb()', () => {
    expect(parseCssColor('rgb(45, 108, 223)')).toEqual({
      hex: '#2D6CDF',
      rgba: { r: 45, g: 108, b: 223, a: 1 },
    });
  });

  it('parses rgba() with alpha', () => {
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual({
      hex: '#000000',
      rgba: { r: 0, g: 0, b: 0, a: 0.5 },
    });
  });

  it('returns undefined for non-rgb syntax', () => {
    expect(parseCssColor('color(srgb 0.1 0.2 0.3)')).toBeUndefined();
    expect(parseCssColor('transparent')).toBeUndefined();
    expect(parseCssColor(undefined)).toBeUndefined();
  });
});

describe('firstFontFamily / parseFontWeight', () => {
  it('takes the first family and strips quotes', () => {
    expect(firstFontFamily('"Inter", sans-serif')).toBe('Inter');
    expect(firstFontFamily('Inter, sans-serif')).toBe('Inter');
    expect(firstFontFamily(undefined)).toBeUndefined();
  });

  it('maps keyword weights to numbers', () => {
    expect(parseFontWeight('700')).toBe(700);
    expect(parseFontWeight('bold')).toBe(700);
    expect(parseFontWeight('normal')).toBe(400);
    expect(parseFontWeight(undefined)).toBe(400);
  });
});

describe('normalizeDomTree', () => {
  const tree = normalizeDomTree(fixture);
  const card = tree.children[0];
  const [h1, button, hiddenP] = card.children;

  it('uses the selector as id and the tag as type', () => {
    expect(tree.id).toBe('body');
    expect(tree.type).toBe('body');
    expect(card.id).toBe('#signup-card');
    expect(card.type).toBe('div');
  });

  it('preserves bbox in page coordinates', () => {
    expect(card.bbox).toEqual({ x: 480, y: 200, width: 480, height: 420 });
  });

  it('keeps the matcher attributes (data-figma-id, id, role, aria-label)', () => {
    expect(card.attributes).toEqual({ id: 'signup-card', 'data-figma-id': '12:346' });
    expect(button.attributes?.['data-figma-id']).toBe('12:350');
    expect(h1.attributes).toBeUndefined();
  });

  it('converts background-color to a SOLID fill, transparent to no fill', () => {
    expect(card.fills).toEqual([
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        color: { hex: '#FFFFFF', rgba: { r: 255, g: 255, b: 255, a: 1 } },
      },
    ]);
    expect(h1.fills).toEqual([]); // rgba(0,0,0,0) background
  });

  it('converts background-image gradients to GRADIENT paints', () => {
    expect(hiddenP.fills).toEqual([{ type: 'GRADIENT', visible: true, opacity: 1 }]);
  });

  it('converts borders to strokes + strokeWeight', () => {
    expect(card.strokeWeight).toBe(1);
    expect(card.strokes).toEqual([
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        color: { hex: '#E6E8EE', rgba: { r: 230, g: 232, b: 238, a: 1 } },
      },
    ]);
    expect(h1.strokes).toEqual([]); // border-style: none
  });

  it('collapses uniform border-radius to one number', () => {
    expect(card.cornerRadius).toBe(12);
    expect(button.cornerRadius).toBe(8);
    expect(h1.cornerRadius).toBeUndefined(); // all zero
  });

  it('maps flexbox to autoLayout with the main-axis gap as itemSpacing', () => {
    expect(card.autoLayout).toEqual({
      direction: 'VERTICAL',
      itemSpacing: 24, // rowGap — main axis for column
      paddingTop: 32,
      paddingRight: 48,
      paddingBottom: 32,
      paddingLeft: 48,
      primaryAxisAlign: 'MIN',
      counterAxisAlign: 'CENTER',
    });
    expect(button.autoLayout).toEqual({
      direction: 'HORIZONTAL',
      itemSpacing: 8, // columnGap — main axis for row
      paddingTop: 12,
      paddingRight: 24,
      paddingBottom: 12,
      paddingLeft: 24,
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'CENTER',
    });
    expect(h1.autoLayout).toBeUndefined(); // display: block
  });

  it('emits a synthetic TEXT child mirroring Figma structure', () => {
    const text = h1.children[0];
    expect(text.type).toBe('TEXT');
    expect(text.id).toBe('#signup-card > h1::text');
    expect(text.text).toBe('Create your account');
    // text color becomes the TEXT node's fill, like Figma
    expect(text.fills[0].color?.hex).toBe('#1A1A2E');
    expect(text.typography).toEqual({
      fontFamily: 'Inter',
      fontSize: 32,
      fontWeight: 700,
      lineHeightPx: 38,
      letterSpacing: -0.5,
      textAlignHorizontal: 'CENTER',
    });
  });

  it('maps text-transform and text-decoration to Figma vocabulary', () => {
    const buttonText = button.children[0];
    expect(buttonText.typography?.textCase).toBe('UPPER');
    const hiddenText = hiddenP.children[0];
    expect(hiddenText.typography?.textDecoration).toBe('UNDERLINE');
  });

  it('keeps visibility:hidden elements with visible=false', () => {
    expect(hiddenP.visible).toBe(false);
    expect(hiddenP.opacity).toBe(0.5);
    expect(hiddenP.children[0].visible).toBe(false); // synthetic text inherits
  });

  it('names nodes from aria-label > id > text > tag', () => {
    expect(button.name).toBe('Sign up'); // aria-label
    expect(card.name).toBe('div#signup-card'); // id
    expect(h1.name).toBe('h1 "Create your account"'); // text
    expect(tree.name).toBe('body'); // bare tag
  });

  it('truncates long text in names but not in text content', () => {
    const p = hiddenP;
    expect(p.name).toBe('p "Terms apply to all new accounts…"');
    expect(p.children[0].text).toBe('Terms apply to all new accounts created today');
  });
});
