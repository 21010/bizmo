// Round-trip corpus (specs.md → test strategy): every valid fixture survives import → export with
// its meaning intact, and a second export is byte-identical (ADR 0009).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK } from '../../../src/extension/core/guards';
import { canonicalXml, roundTrip } from './moddle';

const DIR = 'test/fixtures/bpmn';
/** Fixtures that are invalid on purpose (security and error-handling tests). */
const INVALID = new Set([
  'truncated.bpmn',
  'not-bpmn.bpmn',
  'doctype-xxe.bpmn',
  'billion-laughs.bpmn',
]);
const corpus = readdirSync(DIR).filter((name) => name.endsWith('.bpmn') && !INVALID.has(name));

const read = (name: string) => {
  const text = readFileSync(`${DIR}/${name}`, 'utf8');
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
};

describe('BPMN round-trip corpus', () => {
  it('has fixtures', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(6);
  });

  it.each(corpus)('%s keeps its meaning after save', async (name) => {
    const original = read(name);
    const saved = await roundTrip(original);
    expect(canonicalXml(saved)).toBe(canonicalXml(original));
  });

  it.each(corpus)('%s is stable after the first save', async (name) => {
    const once = await roundTrip(read(name));
    expect(await roundTrip(once)).toBe(once);
  });

  it('keeps unknown extension elements and attributes', async () => {
    const saved = await roundTrip(read('unknown-extensions.bpmn'));
    for (const fragment of [
      'acme:owner="team-orders"',
      'acme:sla="PT4H"',
      'acme:costCenter="4711"',
      '<acme:retryPolicy maxAttempts="5" backoff="exponential"',
      '<acme:tag key="domain" value="sales"',
      'Keep &lt;this&gt; &amp; that',
      '<zeebe:header key="channel" value="email"',
    ]) {
      expect(saved).toContain(fragment);
    }
  });
});
