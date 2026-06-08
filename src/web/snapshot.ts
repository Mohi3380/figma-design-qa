/**
 * In-page DOM snapshot (spec §6.2, first half).
 *
 * `snapshotDom` is serialized into the browser via `page.evaluate`, so it
 * must be fully self-contained: no imports, no closures over module scope.
 * It walks the *rendered* DOM and returns a plain-JSON `RawDomNode` tree —
 * the web-side equivalent of the raw Figma REST payload. All shaping into
 * the normalized schema happens later in `normalizer.ts` (Node-side), so
 * the interesting logic stays unit-testable without a browser.
 *
 * What it captures per element:
 *  - tag, a small whitelist of attributes (mapping attr, id, role, aria-label)
 *  - a unique CSS selector path (the node's identity in the live tree)
 *  - bounding box in *page* coordinates (viewport rect + scroll offset)
 *  - the computed styles the pointer types need (color, background, font-*,
 *    padding, border, radius, flex/gap, opacity, visibility)
 *  - direct text content (text nodes only — children report their own)
 *
 * What it skips: non-rendered elements (`display:none` subtrees have no
 * boxes and can't mismatch visually) and non-visual tags (script/style/…).
 * `visibility:hidden` elements ARE kept with visible=false — they occupy
 * layout space, so "present but hidden" is a real, reportable state.
 */

/** Raw, JSON-safe snapshot of one rendered element. */
export interface RawDomNode {
  tag: string;
  /** Unique CSS selector path from body — the node's stable identity. */
  selector: string;
  attributes: Record<string, string>;
  /** Bounding box in page coordinates (rect + scroll). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Computed styles, exactly as `getComputedStyle` reports them. */
  styles: Record<string, string>;
  /** Direct text content (child text nodes, whitespace-collapsed). */
  text: string;
  /** Tight bounds of the direct text (union of text-node Range rects, page
   * coordinates). Figma TEXT bboxes hug the glyphs; the element box doesn't —
   * without this, every TEXT position/size comparison is a false positive. */
  textBBox?: { x: number; y: number; width: number; height: number } | null;
  /** Graphic-asset info: <img>/<svg>/<picture> or an element with a
   * background-image. naturalWidth/Height are the source resolution of an
   * <img> (for the pixelation check); 0 when not applicable. */
  asset?: { kind: 'icon' | 'image'; naturalWidth: number; naturalHeight: number } | null;
  children: RawDomNode[];
}

/** Style properties the normalizer consumes. Declared once so the in-page
 * collector and the tests agree on the exact list. */
export const CAPTURED_STYLES = [
  'display',
  'visibility',
  'opacity',
  'color',
  'backgroundColor',
  'backgroundImage',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecorationLine',
  'borderTopWidth',
  'borderTopColor',
  'borderTopStyle',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'rowGap',
  'columnGap',
] as const;

export interface SnapshotOptions {
  /** Attribute that explicitly maps a DOM element to a Figma node (§6.3). */
  mappingAttribute: string;
  /** Style property names to capture (pass CAPTURED_STYLES). */
  styleProps: readonly string[];
}

/**
 * Runs INSIDE the browser. Keep self-contained — Playwright serializes it.
 */
export function snapshotDom(options: SnapshotOptions): RawDomNode | null {
  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'LINK',
    'META',
    'NOSCRIPT',
    'TEMPLATE',
    'TITLE',
    'BR',
    'WBR',
  ]);

  function selectorFor(el: Element): string {
    // An id is unique by contract; use it and stop walking up.
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parent = el.parentElement;
    const tag = el.tagName.toLowerCase();
    if (!parent || parent === document.documentElement) return tag;
    const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    const suffix =
      sameTagSiblings.length > 1 ? `:nth-of-type(${sameTagSiblings.indexOf(el) + 1})` : '';
    return `${selectorFor(parent)} > ${tag}${suffix}`;
  }

  function directText(el: Element): string {
    let text = '';
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  /** Union of the direct text nodes' rendered rects — the glyph-tight box. */
  function textBounds(el: Element): RawDomNode['textBBox'] {
    const range = document.createRange();
    let union: DOMRect | null = null;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE || !(child.textContent ?? '').trim()) continue;
      range.selectNodeContents(child);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (!union) {
        union = rect;
      } else {
        const left = Math.min(union.left, rect.left);
        const top = Math.min(union.top, rect.top);
        const right = Math.max(union.right, rect.right);
        const bottom = Math.max(union.bottom, rect.bottom);
        union = new DOMRect(left, top, right - left, bottom - top);
      }
    }
    if (!union) return null;
    return {
      x: union.x + window.scrollX,
      y: union.y + window.scrollY,
      width: union.width,
      height: union.height,
    };
  }

  /** Classify a graphic asset (icon vs image) and capture an <img>'s source
   * resolution for the pixelation check. Returns null for non-asset elements. */
  function assetInfo(el: Element, computed: CSSStyleDeclaration): RawDomNode['asset'] {
    const tag = el.tagName;
    if (tag === 'IMG') {
      const img = el as HTMLImageElement;
      const rect = el.getBoundingClientRect();
      const kind = Math.max(rect.width, rect.height) <= 64 ? 'icon' : 'image';
      return { kind, naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0 };
    }
    if (tag === 'svg') return { kind: 'icon', naturalWidth: 0, naturalHeight: 0 };
    if (tag === 'PICTURE') return { kind: 'image', naturalWidth: 0, naturalHeight: 0 };
    if ((computed.backgroundImage || '').includes('url(')) {
      return { kind: 'image', naturalWidth: 0, naturalHeight: 0 };
    }
    return null;
  }

  function walk(el: Element): RawDomNode | null {
    if (SKIP_TAGS.has(el.tagName)) return null;
    const computed = getComputedStyle(el);
    // display:none subtrees never render — nothing to compare.
    if (computed.display === 'none') return null;

    const rect = el.getBoundingClientRect();
    const styles: Record<string, string> = {};
    for (const prop of options.styleProps) {
      styles[prop] = computed[prop as keyof CSSStyleDeclaration] as string;
    }

    const attributes: Record<string, string> = {};
    for (const name of [options.mappingAttribute, 'id', 'role', 'aria-label']) {
      const value = el.getAttribute(name);
      if (value !== null) attributes[name] = value;
    }

    // Don't descend into an <svg>'s internals — the icon is one unit, and its
    // <path>/<g> children are noise to the comparison.
    const children: RawDomNode[] = [];
    if (el.tagName !== 'svg') {
      for (const child of Array.from(el.children)) {
        const node = walk(child);
        if (node) children.push(node);
      }
    }

    const text = directText(el);
    return {
      asset: assetInfo(el, computed),
      tag: el.tagName.toLowerCase(),
      selector: selectorFor(el),
      attributes,
      bbox: {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
      styles,
      text,
      textBBox: text ? textBounds(el) : null,
      children,
    };
  }

  return walk(document.body);
}
