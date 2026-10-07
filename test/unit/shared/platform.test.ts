import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectExecutionPlatform } from '../../../src/shared/bpmn/platform';

const fixture = (name: string) => readFileSync(`test/fixtures/bpmn/${name}`, 'utf8');

describe('detectExecutionPlatform', () => {
  it('detects Camunda 8 and Camunda 7 from Desktop Modeler metadata', () => {
    expect(detectExecutionPlatform(fixture('c8-order.bpmn'))).toBe('c8');
    expect(detectExecutionPlatform(fixture('c7-invoice.bpmn'))).toBe('c7');
  });

  it('uses the fallback when metadata is missing', () => {
    expect(detectExecutionPlatform(fixture('no-platform.bpmn'))).toBe('c8');
    expect(detectExecutionPlatform(fixture('no-platform.bpmn'), 'c7')).toBe('c7');
  });

  it('works with other namespace prefixes on definitions', () => {
    const xml =
      '<bpmn2:definitions xmlns:modeler="x" modeler:executionPlatform="Camunda Platform">';
    expect(detectExecutionPlatform(xml)).toBe('c7');
  });

  it('reads single-quoted attributes', () => {
    expect(
      detectExecutionPlatform("<definitions modeler:executionPlatform='Camunda Platform'>"),
    ).toBe('c7');
    expect(detectExecutionPlatform("<definitions modeler:executionPlatform='Camunda Cloud'>")).toBe(
      'c8',
    );
  });

  it('ignores the attribute outside the definitions element', () => {
    const xml =
      '<definitions id="d"><process modeler:executionPlatform="Camunda Platform"/></definitions>';
    expect(detectExecutionPlatform(xml)).toBe('c8');
  });
});
