import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK, checkXmlDocument } from '../../../src/extension/core/guards';

const fixture = (name: string) => readFileSync(`test/fixtures/bpmn/${name}`, 'utf8');
const MB = 1024 * 1024;

describe('checkXmlDocument', () => {
  it('accepts a regular BPMN file unchanged', () => {
    const xml = fixture('c8-order.bpmn');
    expect(checkXmlDocument(xml, 10 * MB)).toEqual({ ok: true, content: xml });
  });

  it('strips a byte order mark', () => {
    expect(BYTE_ORDER_MARK.charCodeAt(0)).toBe(0xfeff);
    expect(checkXmlDocument(`${BYTE_ORDER_MARK}<x/>`, MB)).toEqual({ ok: true, content: '<x/>' });
  });

  it.each(['doctype-xxe.bpmn', 'billion-laughs.bpmn'])('blocks DTDs (%s)', (name) => {
    expect(checkXmlDocument(fixture(name), 10 * MB)).toMatchObject({
      ok: false,
      reason: 'doctype',
    });
  });

  it('blocks DTDs regardless of case', () => {
    expect(checkXmlDocument('<!doctype x><x/>', MB).ok).toBe(false);
    expect(checkXmlDocument('<x><!entity a "b"></x>', MB).ok).toBe(false);
  });

  it.each([
    ['a comment', '<x><!-- <!DOCTYPE y> --></x>'],
    ['a CDATA section', '<x><![CDATA[<!ENTITY a "b">]]></x>'],
    ['a processing instruction', '<?note <!DOCTYPE y?><x/>'],
    ['an attribute value', '<x a="&lt;!DOCTYPE" b=\'>\'/>'],
  ])('accepts DOCTYPE text inside %s', (_label, xml) => {
    expect(checkXmlDocument(xml, MB).ok).toBe(true);
  });

  it.each([
    ['after a comment', '<!-- c --><!DOCTYPE x><x/>'],
    ['in an unterminated comment', '<x/><!-- <!DOCTYPE x>'],
    ['in an unterminated tag', '<x a="> <!DOCTYPE y>'],
    ['after a stray "<" in a tag', '<x a="<"><!DOCTYPE y></x>'],
    ['after a stray "<" in text', '<x>a < b <!ENTITY y "z"></x>'],
  ])('blocks a DTD %s', (_label, xml) => {
    expect(checkXmlDocument(xml, MB)).toMatchObject({ ok: false, reason: 'doctype' });
  });

  it('rejects files above the size limit, counting UTF-8 bytes', () => {
    const result = checkXmlDocument('ż'.repeat(600), 1000); // 1200 bytes
    expect(result).toMatchObject({ ok: false, reason: 'tooLarge' });
    expect(result).toHaveProperty('message', expect.stringContaining('bizmo.maxFileSizeMB'));
  });

  it('accepts files exactly at the limit', () => {
    expect(checkXmlDocument('x'.repeat(1000), 1000).ok).toBe(true);
  });
});
