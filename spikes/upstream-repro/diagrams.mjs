// Self-written diagrams for the upstream reproduction (no third-party content).

const NS = `xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0"`;
const C8 = `modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.8.0"`;

/** start → service task → end, in a process with the given id. */
export function simple(processId, { taskType = 'work' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_${processId}" targetNamespace="http://bpmn.io/schema/bpmn" ${C8}>
  <bpmn:process id="${processId}" isExecutable="true">
    <bpmn:startEvent id="Start_${processId}"><bpmn:outgoing>Flow_a_${processId}</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="Task_${processId}" name="Work">
      <bpmn:extensionElements><zeebe:taskDefinition type="${taskType}" /></bpmn:extensionElements>
      <bpmn:incoming>Flow_a_${processId}</bpmn:incoming><bpmn:outgoing>Flow_b_${processId}</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End_${processId}"><bpmn:incoming>Flow_b_${processId}</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_a_${processId}" sourceRef="Start_${processId}" targetRef="Task_${processId}" />
    <bpmn:sequenceFlow id="Flow_b_${processId}" sourceRef="Task_${processId}" targetRef="End_${processId}" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${processId}">
    <bpmndi:BPMNPlane id="Plane_${processId}" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="Start_${processId}_di" bpmnElement="Start_${processId}"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_${processId}_di" bpmnElement="Task_${processId}"><dc:Bounds x="190" y="78" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_${processId}_di" bpmnElement="End_${processId}"><dc:Bounds x="350" y="100" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_a_${processId}_di" bpmnElement="Flow_a_${processId}"><di:waypoint x="136" y="118" /><di:waypoint x="190" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_b_${processId}_di" bpmnElement="Flow_b_${processId}"><di:waypoint x="290" y="118" /><di:waypoint x="350" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

/** A diagram whose plane references the process by an ID containing spaces (unresolvable). */
export function unresolvablePlane() {
  const id = 'Process_{{ ID:process }}';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_template" targetNamespace="http://bpmn.io/schema/bpmn" ${C8}>
  <bpmn:process id="${id}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${id}">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="100" y="100" width="36" height="36" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
