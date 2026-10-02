// Generates a Camunda 8 BPMN diagram with N chained service tasks (with DI) for performance spikes.
export function generate(taskCount) {
  const shapes = [];
  const flows = [];
  const di = [];
  const pos = (i) => ({ x: 200 + (i % 20) * 150, y: 100 + Math.floor(i / 20) * 150 });
  const ids = ['start', ...Array.from({ length: taskCount }, (_, i) => `task_${i}`), 'end'];
  ids.forEach((id, i) => {
    const { x, y } = pos(i);
    if (id === 'start') {
      shapes.push(`<bpmn:startEvent id="start" />`);
      di.push(`<bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="${x}" y="${y + 22}" width="36" height="36" /></bpmndi:BPMNShape>`);
    } else if (id === 'end') {
      shapes.push(`<bpmn:endEvent id="end" />`);
      di.push(`<bpmndi:BPMNShape id="end_di" bpmnElement="end"><dc:Bounds x="${x}" y="${y + 22}" width="36" height="36" /></bpmndi:BPMNShape>`);
    } else {
      shapes.push(`<bpmn:serviceTask id="${id}" name="Task ${i}"><bpmn:extensionElements><zeebe:taskDefinition type="job-${i}" /></bpmn:extensionElements></bpmn:serviceTask>`);
      di.push(`<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="100" height="80" /></bpmndi:BPMNShape>`);
    }
    if (i > 0) {
      const from = pos(i - 1);
      flows.push(`<bpmn:sequenceFlow id="flow_${i}" sourceRef="${ids[i - 1]}" targetRef="${id}" />`);
      di.push(`<bpmndi:BPMNEdge id="flow_${i}_di" bpmnElement="flow_${i}"><di:waypoint x="${from.x + 100}" y="${from.y + 40}" /><di:waypoint x="${x}" y="${y + 40}" /></bpmndi:BPMNEdge>`);
    }
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="defs" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.6.0">
<bpmn:process id="generated" isExecutable="true">${shapes.join('')}${flows.join('')}</bpmn:process>
<bpmndi:BPMNDiagram id="diagram"><bpmndi:BPMNPlane id="plane" bpmnElement="generated">${di.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
