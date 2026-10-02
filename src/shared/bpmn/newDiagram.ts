import type { ExecutionPlatform } from '../protocol';

/** Execution platform versions written into new diagrams (Camunda Desktop Modeler convention). */
export const DEFAULT_PLATFORM_VERSION: Record<ExecutionPlatform, string> = {
  c8: '8.8.0',
  c7: '7.24.0',
};

const PLATFORM_NAME: Record<ExecutionPlatform, string> = {
  c8: 'Camunda Cloud',
  c7: 'Camunda Platform',
};

const PLATFORM_NAMESPACE: Record<ExecutionPlatform, string> = {
  c8: 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"',
  c7: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
};

/** Random 7-character suffix in the style of Desktop Modeler IDs (e.g. `Definitions_0f9wx1k`). */
export function randomIdSuffix(random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 7; i++) suffix += Math.floor(random() * 36).toString(36);
  return suffix;
}

/** A minimal executable diagram: one start event, with diagram interchange and platform metadata. */
export function newDiagramXml(
  platform: ExecutionPlatform,
  idSuffix: string = randomIdSuffix(),
): string {
  const process = `Process_${idSuffix}`;
  const ttl = platform === 'c7' ? ' camunda:historyTimeToLive="180"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ${PLATFORM_NAMESPACE[platform]} xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_${idSuffix}" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="${PLATFORM_NAME[platform]}" modeler:executionPlatformVersion="${DEFAULT_PLATFORM_VERSION[platform]}">
  <bpmn:process id="${process}" isExecutable="true"${ttl}>
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${process}">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="182" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
