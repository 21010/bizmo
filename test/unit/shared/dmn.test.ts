import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkXmlDocument } from '../../../src/extension/core/guards';
import { DEFAULT_PLATFORM_VERSION } from '../../../src/shared/camunda/metadata';
import { detectExecutionPlatform } from '../../../src/shared/camunda/platform';
import { newDmnXml } from '../../../src/shared/dmn/newDiagram';
import { DMN13_NAMESPACE, oldDmnVersion } from '../../../src/shared/dmn/version';
import { parseDmn } from './moddle';

const fixture = (name: string) => readFileSync(`test/fixtures/dmn/${name}`, 'utf8');

describe('oldDmnVersion', () => {
  it.each([
    ['c7-dmn11.dmn', '1.1'],
    ['c7-dmn12.dmn', '1.2'],
    ['c8-dish.dmn', undefined],
    ['c7-dish.dmn', undefined],
  ])('%s → %s', (name, version) => {
    expect(oldDmnVersion(fixture(name))).toBe(version);
  });

  it('recognises prefixed namespace declarations and single quotes', () => {
    expect(
      oldDmnVersion("<dmn:definitions xmlns:dmn='http://www.omg.org/spec/DMN/20151101/dmn.xsd'>"),
    ).toBe('1.1');
  });

  it('does not take a namespace mentioned in text for a declaration', () => {
    expect(
      oldDmnVersion(
        `<definitions xmlns="${DMN13_NAMESPACE}"><text>http://www.omg.org/spec/DMN/20151101/dmn.xsd</text></definitions>`,
      ),
    ).toBeUndefined();
  });
});

describe('newDmnXml', () => {
  it.each(['c8', 'c7'] as const)('creates a valid %s DMN 1.3 file', async (platform) => {
    const xml = newDmnXml(platform, 'abc1234');
    expect(detectExecutionPlatform(xml)).toBe(platform);
    expect(oldDmnVersion(xml)).toBeUndefined();
    expect(xml).toContain(`xmlns="${DMN13_NAMESPACE}"`);
    expect(xml).toContain(
      `modeler:executionPlatformVersion="${DEFAULT_PLATFORM_VERSION[platform]}"`,
    );
    expect(checkXmlDocument(xml, 1024 * 1024).ok).toBe(true);

    const { definitions, warnings } = await parseDmn(xml);
    expect(warnings).toEqual([]);
    expect(definitions.id).toBe('Definitions_abc1234');
    expect(definitions.drgElement.map((e) => [e.$type, e.id])).toEqual([
      ['dmn:Decision', 'Decision_abc1234'],
    ]);
  });

  it('sets historyTimeToLive for Camunda 7 only (required by Camunda 7.20+)', () => {
    expect(newDmnXml('c7')).toContain('camunda:historyTimeToLive="180"');
    expect(newDmnXml('c8')).not.toContain('historyTimeToLive');
  });
});
