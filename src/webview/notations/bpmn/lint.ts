// BPMN linting in the webview (M6, ADR 0013): @camunda/linting (Camunda Modeler's linter) runs on the
// modeler's own model, shows problems on the canvas and in the properties panel, and reports them
// to the host for VS Code's Problems view.
import { Linter, type LintReport } from '@camunda/linting';
import type BaseViewer from 'bpmn-js/lib/BaseViewer';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type { Element as DiagramElement } from 'diagram-js/lib/model/Types';
import {
  bounded,
  LIMITS,
  type ExecutionPlatform,
  type LintProblem,
  type LintSeverity,
} from '../../../shared/protocol';

/** The `linting` service of `@camunda/linting/modeler`. */
interface LintingService {
  setErrors(reports: LintReport[]): void;
  activate(): void;
  deactivate(): void;
  showError(report: LintReport): void;
}

/** Camunda 7 and Camunda 8 modelers alike. */
export type LintableModeler = BaseViewer;

/** Waits for a pause in editing, like Camunda Modeler. */
const DEBOUNCE_MS = 300;

const SEVERITY: Record<LintReport['category'], LintSeverity> = {
  error: 'error',
  'rule-error': 'error',
  warn: 'warning',
  info: 'info',
};

/** Converts reports into bounded protocol problems. */
export function toProblems(reports: LintReport[]): LintProblem[] {
  return reports.slice(0, LIMITS.lintProblems).map((report) => ({
    elementId: bounded(report.id, LIMITS.shortText),
    message: bounded(report.message),
    severity: SEVERITY[report.category],
    rule: bounded(report.rule, LIMITS.shortText),
  }));
}

export class DiagramLinter {
  private enabled = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Increases with every scheduled run, so results of an outdated run are dropped. */
  private generation = 0;
  private reports: LintReport[] = [];
  private readonly linters: Partial<Record<ExecutionPlatform, Linter>> = {};

  constructor(
    private readonly publish: (problems: LintProblem[]) => void,
    private readonly warn: (message: string) => void,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Turns linting on or off for the current modeler (the user setting). */
  setEnabled(enabled: boolean, modeler: LintableModeler | undefined, platform?: ExecutionPlatform) {
    this.enabled = enabled;
    if (!modeler) return;
    if (enabled && platform) {
      modeler.get<LintingService>('linting', true).activate();
      this.schedule(modeler, platform);
    } else {
      this.clear(modeler);
    }
  }

  /** Lints after a short pause; called after every import and every change. */
  schedule(modeler: LintableModeler, platform: ExecutionPlatform): void {
    const generation = ++this.generation;
    clearTimeout(this.timer);
    if (!this.enabled) return;
    this.timer = setTimeout(() => {
      void this.run(modeler, platform, generation);
    }, DEBOUNCE_MS);
  }

  /** Forgets problems, e.g. after a failed import or when linting is turned off. */
  clear(modeler: LintableModeler | undefined): void {
    this.generation++;
    clearTimeout(this.timer);
    this.reports = [];
    if (modeler) {
      const linting = modeler.get<LintingService>('linting', true);
      linting.setErrors([]);
      linting.deactivate();
    }
    this.publish([]);
  }

  /** Selects an element and shows its problem in the properties panel, if it has one. */
  reveal(modeler: LintableModeler, elementId: string): void {
    try {
      const report = this.reports.find((candidate) => candidate.id === elementId);
      if (report) {
        modeler.get<LintingService>('linting', true).showError(report);
        return;
      }
      const element = modeler.get<ElementRegistry>('elementRegistry', true).get(elementId) as
        DiagramElement | undefined;
      if (!element) return;
      modeler.get<Canvas>('canvas', true).scrollToElement(element);
      modeler.get<Selection>('selection', true).select(element);
    } catch (error) {
      this.warn(`Could not show ${elementId}: ${String(error)}`);
    }
  }

  private async run(
    modeler: LintableModeler,
    platform: ExecutionPlatform,
    generation: number,
  ): Promise<void> {
    // Typed `any` by bpmn-js; undefined before the first import.
    const definitions: unknown = modeler.getDefinitions();
    if (typeof definitions !== 'object' || definitions === null) return;
    let reports: LintReport[];
    try {
      reports = await this.linterFor(platform).lint(definitions);
    } catch (error) {
      this.warn(`Linting failed: ${String(error)}`);
      return;
    }
    if (generation !== this.generation || !this.enabled) return;
    this.reports = reports;
    const linting = modeler.get<LintingService>('linting', true);
    linting.setErrors(reports);
    linting.activate();
    this.publish(toProblems(reports));
  }

  private linterFor(platform: ExecutionPlatform): Linter {
    // Camunda 8 diagrams are "cloud", Camunda 7 diagrams "platform" in @camunda/linting.
    this.linters[platform] ??= new Linter({
      modeler: 'desktop',
      type: platform === 'c8' ? 'cloud' : 'platform',
    });
    return this.linters[platform];
  }
}
