// Test helpers: BPMN parsing/serialisation with the same moddle packages the modelers use,
// and an order-insensitive canonical form of an XML document.
import { BpmnModdle } from 'bpmn-moddle';
import { Parser } from 'saxen';
import camunda from 'camunda-bpmn-moddle/resources/camunda.json' with { type: 'json' };
import zeebe from 'zeebe-bpmn-moddle/resources/zeebe.json' with { type: 'json' };

import { detectExecutionPlatform } from '../../../src/shared/camunda/platform';

/**
 * Like the modelers: Camunda 7 diagrams use the `camunda` descriptor, Camunda 8 the `zeebe` one.
 * Never both — they define conflicting properties and the process would fail to parse.
 */
const moddle = (xml: string) =>
  BpmnModdle(detectExecutionPlatform(xml) === 'c7' ? { camunda } : { zeebe });

interface ParsedElement {
  id?: string;
}
interface Definitions extends ParsedElement {
  rootElements: ParsedElement[];
}

export async function parseBpmn(
  xml: string,
): Promise<{ definitions: Definitions; warnings: string[] }> {
  const { rootElement, warnings } = await moddle(xml).fromXML(xml, 'bpmn:Definitions');
  return {
    definitions: rootElement as unknown as Definitions,
    warnings: warnings.map((w: { message: string }) => w.message),
  };
}

/** import → export, as `saveXML({ format: true })` does. */
export async function roundTrip(xml: string): Promise<string> {
  const instance = moddle(xml);
  const { rootElement } = await instance.fromXML(xml, 'bpmn:Definitions');
  const { xml: out } = await instance.toXML(rootElement, { format: true });
  return out;
}

interface Node {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: Node[];
}

/**
 * Canonical form for semantic comparison: sibling order, attribute order, whitespace, and
 * namespace declarations are ignored; element names, attribute values, and text are kept.
 */
export function canonicalXml(xml: string): string {
  const root: Node = { name: '#root', attributes: {}, text: '', children: [] };
  const stack: Node[] = [root];
  const parser = new Parser();
  parser.on(
    'openTag',
    (
      name: string,
      getAttrs: () => Record<string, string>,
      decode: (value: string) => string,
      selfClosing: boolean,
    ) => {
      // Entity spelling (&lt; vs &#60;) is not meaningful: compare decoded values.
      const attributes = Object.fromEntries(
        Object.entries(getAttrs())
          .filter(([key]) => key !== 'xmlns' && !key.startsWith('xmlns:'))
          .map(([key, value]) => [key, decode(value)]),
      );
      const node: Node = { name, attributes, text: '', children: [] };
      stack.at(-1)?.children.push(node);
      if (!selfClosing) stack.push(node);
    },
  );
  parser.on('closeTag', () => {
    stack.pop();
  });
  const appendText = (text: string) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  };
  parser.on('text', (text: string, decode: (t: string) => string) => {
    appendText(decode(text));
  });
  parser.on('cdata', appendText);
  parser.on('error', (error: Error) => {
    throw error;
  });
  parser.parse(xml);

  const render = (node: Node): string => {
    const attributes = Object.entries(node.attributes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    const children = node.children.map(render).sort().join('');
    return `<${node.name} ${attributes}>${node.text.trim()}${children}</${node.name}>`;
  };
  return render(root);
}
