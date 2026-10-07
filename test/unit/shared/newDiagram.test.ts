import { describe, expect, it } from 'vitest';
import { detectExecutionPlatform } from '../../../src/shared/camunda/platform';
import {
  DEFAULT_PLATFORM_VERSION,
  newDiagramXml,
  randomIdSuffix,
} from '../../../src/shared/bpmn/newDiagram';
import { checkXmlDocument } from '../../../src/extension/core/guards';
import { parseBpmn } from './moddle';

describe('newDiagramXml', () => {
  it.each(['c8', 'c7'] as const)(
    'creates a valid %s diagram that round-trips',
    async (platform) => {
      const xml = newDiagramXml(platform, 'abc1234');
      expect(detectExecutionPlatform(xml)).toBe(platform);
      expect(xml).toContain(
        `modeler:executionPlatformVersion="${DEFAULT_PLATFORM_VERSION[platform]}"`,
      );
      expect(checkXmlDocument(xml, 1024 * 1024).ok).toBe(true);

      const { definitions, warnings } = await parseBpmn(xml);
      expect(warnings).toEqual([]);
      expect(definitions.id).toBe('Definitions_abc1234');
      expect(definitions.rootElements.map((e) => e.id)).toEqual(['Process_abc1234']);
    },
  );

  it('sets historyTimeToLive for Camunda 7 only (required by recent C7 engines)', () => {
    expect(newDiagramXml('c7')).toContain('camunda:historyTimeToLive="180"');
    expect(newDiagramXml('c8')).not.toContain('historyTimeToLive');
  });
});

describe('randomIdSuffix', () => {
  it('returns 7 base-36 characters', () => {
    expect(randomIdSuffix()).toMatch(/^[0-9a-z]{7}$/);
    expect(randomIdSuffix(() => 0)).toBe('0000000');
    expect(randomIdSuffix(() => 0.999)).toBe('zzzzzzz');
  });
});
