// Minimal typings for packages used only by tests.

declare module 'saxen' {
  export class Parser {
    on(event: string, callback: (...args: never[]) => void): this;
    parse(xml: string): this;
  }
}

declare module 'bpmn-moddle' {
  interface Moddle {
    fromXML(
      xml: string,
      typeName?: string,
    ): Promise<{ rootElement: object; warnings: { message: string }[] }>;
    toXML(element: object, options?: { format?: boolean }): Promise<{ xml: string }>;
  }
  /** Factory (called without `new`) with additional moddle packages. */
  export function BpmnModdle(packages?: Record<string, unknown>): Moddle;
}

declare module 'dmn-moddle' {
  interface Moddle {
    fromXML(
      xml: string,
      typeName?: string,
    ): Promise<{ rootElement: object; warnings: { message: string }[] }>;
  }
  /** Factory (called without `new`) with additional moddle packages. */
  export function DmnModdle(packages?: Record<string, unknown>): Moddle;
}
