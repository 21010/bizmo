import type { ExecutionPlatform } from '../protocol';
import { platformAttributes, randomIdSuffix } from '../camunda/metadata';

export { DEFAULT_PLATFORM_VERSION, randomIdSuffix } from '../camunda/metadata';

const PLATFORM_NAMESPACE: Record<ExecutionPlatform, string> = {
  c8: 'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"',
  c7: 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
};

/** A minimal executable diagram: one start event, with diagram interchange and platform metadata. */
export function newDiagramXml(
  platform: ExecutionPlatform,
  idSuffix: string = randomIdSuffix(),
): string {
  const process = `Process_${idSuffix}`;
  const ttl = platform === 'c7' ? ' camunda:historyTimeToLive="180"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ${PLATFORM_NAMESPACE[platform]} xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_${idSuffix}" targetNamespace="http://bpmn.io/schema/bpmn" ${platformAttributes(platform)}>
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
