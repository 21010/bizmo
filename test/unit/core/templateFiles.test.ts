import { describe, expect, it } from 'vitest';
import {
  collectTemplates,
  parseTemplateFile,
  TEMPLATE_LIMITS,
  templatePlatform,
} from '../../../src/extension/notations/bpmn/templateFiles';

const C8_SCHEMA =
  'https://unpkg.com/@camunda/zeebe-element-templates-json-schema/resources/schema.json';
const C7_SCHEMA = 'https://unpkg.com/@camunda/element-templates-json-schema/resources/schema.json';

describe('templatePlatform', () => {
  it('classifies by $schema; templates without one are Camunda 7', () => {
    expect(templatePlatform({ $schema: C8_SCHEMA })).toBe('c8');
    expect(templatePlatform({ $schema: C7_SCHEMA })).toBe('c7');
    expect(templatePlatform({ id: 'legacy' })).toBe('c7');
  });
});

describe('parseTemplateFile', () => {
  it('accepts a single template or an array', () => {
    expect(parseTemplateFile('{"id":"a"}')).toEqual([{ id: 'a' }]);
    expect(parseTemplateFile('[{"id":"a"},{"id":"b"}]')).toHaveLength(2);
  });

  it.each([
    ['not JSON', '{id:'],
    ['a string', '"template"'],
    ['an array of numbers', '[1,2]'],
    ['null', 'null'],
  ])('rejects %s', (_label, text) => {
    expect(() => parseTemplateFile(text)).toThrow();
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the key %s anywhere', (key) => {
    expect(() =>
      parseTemplateFile(`{"id":"a","properties":[{"${key}":{"polluted":true}}]}`),
    ).toThrow(`forbidden key "${key}"`);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('collectTemplates', () => {
  it('splits templates by platform and reports broken files without failing the rest', () => {
    const { templates, errors } = collectTemplates([
      {
        path: 'a.json',
        text: JSON.stringify([
          { $schema: C8_SCHEMA, id: 'c8' },
          { $schema: C7_SCHEMA, id: 'c7' },
        ]),
      },
      { path: 'broken.json', text: '{' },
      { path: 'b.json', text: JSON.stringify({ id: 'legacy' }) },
    ]);
    expect(templates.c8.map((t) => t['id'])).toEqual(['c8']);
    expect(templates.c7.map((t) => t['id'])).toEqual(['c7', 'legacy']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^broken\.json: /);
  });

  it('skips files above the per-file limit', () => {
    const big = JSON.stringify({ id: 'big', padding: 'x'.repeat(TEMPLATE_LIMITS.fileBytes) });
    const { templates, errors } = collectTemplates([{ path: 'big.json', text: big }]);
    expect(templates.c7).toEqual([]);
    expect(errors[0]).toContain('larger than');
  });

  it('stops at the total template count', () => {
    const many = JSON.stringify(
      Array.from({ length: TEMPLATE_LIMITS.templates }, (_, i) => ({ id: `t${i}` })),
    );
    const { templates, errors } = collectTemplates([
      { path: 'many.json', text: many },
      { path: 'one-more.json', text: '{"id":"extra"}' },
    ]);
    expect(templates.c7).toHaveLength(TEMPLATE_LIMITS.templates);
    expect(errors[0]).toContain('one-more.json');
  });
});
