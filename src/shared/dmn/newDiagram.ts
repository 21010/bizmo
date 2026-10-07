import type { ExecutionPlatform } from '../protocol';
import { platformAttributes, randomIdSuffix } from '../camunda/metadata';
import { DMN13_NAMESPACE } from './version';

const PLATFORM_NAMESPACE: Record<ExecutionPlatform, string> = {
  c8: '',
  c7: ' xmlns:camunda="http://camunda.org/schema/1.0/dmn"',
};

/**
 * A new DMN 1.3 file: one decision with an empty decision table (one input, one output), as in
 * Camunda Desktop Modeler, with diagram interchange and platform metadata. Camunda 7 decisions get
 * a history time to live, which Camunda 7.20+ requires for deployment.
 */
export function newDmnXml(
  platform: ExecutionPlatform,
  idSuffix: string = randomIdSuffix(),
): string {
  const decision = `Decision_${idSuffix}`;
  const ttl = platform === 'c7' ? ' camunda:historyTimeToLive="180"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="${DMN13_NAMESPACE}" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"${PLATFORM_NAMESPACE[platform]} xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_${idSuffix}" name="DRD" namespace="http://camunda.org/schema/1.0/dmn" ${platformAttributes(platform)}>
  <decision id="${decision}" name="Decision 1"${ttl}>
    <decisionTable id="DecisionTable_${idSuffix}">
      <input id="Input_1">
        <inputExpression id="InputExpression_1" typeRef="string">
          <text></text>
        </inputExpression>
      </input>
      <output id="Output_1" typeRef="string" />
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_${idSuffix}">
      <dmndi:DMNShape id="DMNShape_${idSuffix}" dmnElementRef="${decision}">
        <dc:Bounds height="80" width="180" x="160" y="100" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;
}
