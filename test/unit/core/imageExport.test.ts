import { describe, expect, it } from 'vitest';
import { checkExportedImage } from '../../../src/extension/core/imageExport';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString(
  'base64',
);

describe('checkExportedImage', () => {
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
    '<?xml version="1.0" encoding="utf-8"?>\n<!-- created with bpmn-js / http://bpmn.io -->\n<svg width="10">',
    '  <svg>',
    '<svg><text>Ship only=3 &lt;b onload=x&gt;</text></svg>',
    '<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg>',
  ])('accepts SVG markup %#', (svg) => {
    const result = checkExportedImage('svg', svg);
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.bytes)).toBe(svg);
  });

  it.each([
    ['other markup', '<html><svg></svg></html>'],
    ['text', 'hello'],
    ['a script', '<svg><script>alert(1)</script></svg>'],
    ['an event handler', '<svg onload="alert(1)"></svg>'],
    ['foreign HTML', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['a DOCTYPE with entities', '<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>'],
  ])('rejects SVG with %s', (_label, svg) => {
    expect(checkExportedImage('svg', svg).ok).toBe(false);
  });

  it('accepts base64 PNG bytes', () => {
    const result = checkExportedImage('png', png);
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it.each([
    ['other bytes', Buffer.from('GIF89a..').toString('base64')],
    ['invalid base64', '@@@@'],
    ['a data URL', `data:image/png;base64,${png}`],
    ['empty data', ''],
  ])('rejects a PNG with %s', (_label, data) => {
    expect(checkExportedImage('png', data).ok).toBe(false);
  });
});
