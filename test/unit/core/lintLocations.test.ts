import { describe, expect, it } from 'vitest';
import { locateElementIds } from '../../../src/extension/notations/bpmn/lintLocations';

const xml = [
  '<bpmn:definitions id="Defs" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">',
  '  <bpmn:process id="Process_1" isExecutable="true">',
  '    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="End" />',
  '    <bpmn:serviceTask id = \'Task_1\' name="Task" />',
  '  </bpmn:process>',
  '  <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1" />',
  '</bpmn:definitions>',
].join('\n');

const valueAt = (text: string, span: { start: number; end: number }) =>
  text.slice(span.start, span.end);

describe('locateElementIds', () => {
  it("finds the id attribute's value, not references to the element", () => {
    const span = locateElementIds(xml, ['Task_1']).get('Task_1');
    expect(span).toBeDefined();
    if (!span) return;
    expect(valueAt(xml, span)).toBe('Task_1');
    expect(xml.slice(0, span.start)).toContain('<bpmn:serviceTask id = ');
  });

  it('does not match a longer id that starts with the same text', () => {
    const span = locateElementIds(xml, ['Task_1']).get('Task_1');
    expect(span && xml.slice(span.end, span.end + 1)).toBe("'");
  });

  it('ignores attributes that merely end in "id"', () => {
    const text = '<a processId="X" /><b xml:id="X" /><c id="X" />';
    const span = locateElementIds(text, ['X']).get('X');
    expect(span?.start).toBe(text.indexOf('<c id="X"') + '<c id="'.length);
  });

  it('treats ids as literal text, not as patterns', () => {
    const text = '<a id="Task_1" /><b id="Task.1" />';
    const span = locateElementIds(text, ['Task.1']).get('Task.1');
    expect(span?.start).toBe(text.indexOf('Task.1'));
  });

  it('falls back to the start of the file for an unknown id', () => {
    expect(locateElementIds(xml, ['Nope']).get('Nope')).toEqual({ start: 0, end: 0 });
  });

  it('locates many ids in one call, each once', () => {
    const spans = locateElementIds(xml, ['Process_1', 'Flow_1', 'Process_1']);
    expect([...spans.keys()]).toEqual(['Process_1', 'Flow_1']);
    for (const [id, span] of spans) expect(valueAt(xml, span)).toBe(id);
  });
});
