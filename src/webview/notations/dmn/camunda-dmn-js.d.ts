// The parts of camunda-dmn-js, dmn-js and @bpmn-io/dmn-migrate (untyped) that Bizmo uses.

declare module 'camunda-dmn-js' {
  /** One view of a DMN file: the DRD, or a decision's table or expression. */
  export interface DmnView {
    /** `drd`, `decisionTable`, `literalExpression`, or `boxedExpression`. */
    type: string;
    element: { id: string; name?: string };
  }

  /** The editor of one view type (diagram-js for the DRD, table/text editors otherwise). */
  export interface DmnViewer {
    on(event: string, callback: (event: never) => void): void;
    saveSVG?(): Promise<{ svg: string }>;
  }

  export interface DmnModelerOptions {
    container: HTMLElement;
    common?: Record<string, unknown>;
    drd?: Record<string, unknown>;
    decisionTable?: Record<string, unknown>;
    literalExpression?: Record<string, unknown>;
    boxedExpression?: Record<string, unknown>;
  }

  class DmnModeler {
    constructor(options: DmnModelerOptions);
    importXML(xml: string): Promise<{ warnings: unknown[] }>;
    saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>;
    getDefinitions(): { drgElement?: unknown[] } | undefined;
    getViews(): DmnView[];
    getActiveView(): DmnView | undefined;
    getActiveViewer(): DmnViewer | undefined;
    open(view: DmnView): Promise<{ warnings: unknown[] }>;
    on(event: string, callback: (event: never) => void): void;
    destroy(): void;
  }

  export class CamundaCloudModeler extends DmnModeler {}
  export class CamundaPlatformModeler extends DmnModeler {}
}

declare module '@bpmn-io/dmn-migrate' {
  /** Converts DMN 1.1 and 1.2 to DMN 1.3; returns DMN 1.3 unchanged. */
  export function migrateDiagram(xml: string): Promise<string>;
}
