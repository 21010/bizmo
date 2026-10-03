// The parts of @camunda/linting (untyped) that Bizmo uses.

declare module '@camunda/linting' {
  /** One finding; `id` is the element's id, `category` comes from the rule configuration. */
  export interface LintReport {
    id: string;
    message: string;
    category: 'error' | 'warn' | 'info' | 'rule-error';
    rule: string;
  }

  export class Linter {
    constructor(options?: { modeler?: 'desktop' | 'web'; type?: 'cloud' | 'platform' });
    /** Lints XML or already imported definitions; returns nothing without a platform version. */
    lint(contents: string | object): Promise<LintReport[]>;
  }
}

declare module '@camunda/linting/modeler' {
  import type { ModuleDeclaration } from 'didi';

  /** bpmn-js module: problem markers on the canvas and in the properties panel. */
  const lintingModule: ModuleDeclaration;
  export default lintingModule;
}
