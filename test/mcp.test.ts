import { describe, expect, it } from 'vitest';
import { findMcpNode, mcpExtraction, mcpToNormalized, parseMcpMetadata, McpParseError } from '../src/figma/mcp.js';

const XML = `<canvas id="6:1281" name="User Interface" x="0" y="0" width="0" height="0">
  <frame id="20:2886" name="home" x="100" y="200" width="439" height="956">
    <frame id="20:2887" name="Header" x="0" y="0" width="439" height="64">
      <text id="20:2888" name="Pawsibly Yours" x="20" y="20" width="200" height="24" />
    </frame>
    <instance id="20:2890" name="Adopt &amp; Foster" x="0" y="900" width="439" height="56" />
  </frame>
  <frame id="20:2844" name="login" x="600" y="200" width="439" height="956" />
</canvas>`;

describe('parseMcpMetadata', () => {
  it('builds the nesting tree', () => {
    const root = parseMcpMetadata(XML);
    expect(root.tag).toBe('canvas');
    expect(root.children.map((c) => c.id)).toEqual(['20:2886', '20:2844']);
    expect(root.children[0].children).toHaveLength(2); // Header + instance
  });

  it('throws on empty input', () => {
    expect(() => parseMcpMetadata('no tags here')).toThrow(McpParseError);
  });
});

describe('findMcpNode', () => {
  it('finds by colon or dash form', () => {
    const root = parseMcpMetadata(XML);
    expect(findMcpNode(root, '20:2886')?.name).toBe('home');
    expect(findMcpNode(root, '20-2886')?.name).toBe('home');
    expect(findMcpNode(root, '9:9')).toBeUndefined();
  });
});

describe('mcpToNormalized', () => {
  const root = parseMcpMetadata(XML);
  const home = findMcpNode(root, '20:2886')!;
  const tree = mcpToNormalized(home);

  it('re-bases the extracted frame to origin (0,0) and accumulates child offsets', () => {
    expect(tree.bbox).toEqual({ x: 0, y: 0, width: 439, height: 956 });
    const header = tree.children[0];
    expect(header.bbox).toEqual({ x: 0, y: 0, width: 439, height: 64 });
    // text is at header(0,0) + (20,20) = (20,20) absolute within the frame
    expect(header.children[0].bbox).toEqual({ x: 20, y: 20, width: 200, height: 24 });
    // instance at frame(0,0)+(0,900)
    expect(tree.children[1].bbox).toEqual({ x: 0, y: 900, width: 439, height: 56 });
  });

  it('maps MCP tags to schema types and decodes entities', () => {
    expect(tree.type).toBe('FRAME');
    expect(tree.children[0].type).toBe('FRAME');
    expect(tree.children[0].children[0].type).toBe('TEXT');
    expect(tree.children[1].type).toBe('INSTANCE');
    expect(tree.children[1].name).toBe('Adopt & Foster'); // &amp; decoded
  });

  it('exposes text-layer names as text and leaves fills/typography empty', () => {
    const text = tree.children[0].children[0];
    expect(text.text).toBe('Pawsibly Yours');
    expect(text.fills).toEqual([]);
    expect(text.typography).toBeUndefined();
  });
});

describe('mcpExtraction', () => {
  it('produces a figma-mcp DesignExtraction for the chosen node', () => {
    const ext = mcpExtraction(XML, '20-2886', 'FILEKEY');
    expect(ext.source).toBe('figma-mcp');
    expect(ext.fileKey).toBe('FILEKEY');
    expect(ext.frameId).toBe('20:2886');
    expect(ext.frameName).toBe('home');
    expect(ext.tree.children).toHaveLength(2);
  });

  it('throws when the node is absent', () => {
    expect(() => mcpExtraction(XML, '99:99', 'K')).toThrow(McpParseError);
  });
});
