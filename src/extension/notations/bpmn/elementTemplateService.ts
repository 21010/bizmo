import * as vscode from 'vscode';
import {
  collectTemplates,
  TEMPLATE_LIMITS,
  type TemplateFile,
  type TemplateSet,
} from './templateFiles';

/** Camunda Desktop Modeler's convention (ADR 0010, D4). */
export const TEMPLATE_GLOB = '**/.camunda/element-templates/**/*.json';
const EXCLUDE = '**/node_modules/**';
const RELOAD_DELAY_MS = 300;

const empty = (): TemplateSet => ({ c7: [], c8: [] });

/**
 * Element templates from the workspace. Workspace content that configures the modeler is only
 * read in trusted workspaces (security_guidelines.md → Workspace Trust); in Restricted Mode the
 * template files are never opened.
 */
export class ElementTemplateService implements vscode.Disposable {
  private templates = empty();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waiting: (() => void)[] = [];
  private restrictedNoticeShown = false;

  constructor(private readonly log: vscode.LogOutputChannel) {
    const watcher = vscode.workspace.createFileSystemWatcher(TEMPLATE_GLOB);
    const schedule = () => {
      void this.reload(RELOAD_DELAY_MS);
    };
    this.disposables.push(
      watcher,
      watcher.onDidCreate(schedule),
      watcher.onDidChange(schedule),
      watcher.onDidDelete(schedule),
      vscode.workspace.onDidChangeWorkspaceFolders(schedule),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.log.info('Workspace trusted: loading element templates');
        void this.reload(0);
      }),
    );
    void this.reload(0);
  }

  /** Templates for the webviews; always empty in Restricted Mode. */
  current(): TemplateSet {
    return vscode.workspace.isTrusted ? this.templates : empty();
  }

  /**
   * (Re)loads after `delay` ms; calls within the delay are combined. Resolves when the load that
   * covers this call has finished.
   */
  reload(delay = 0): Promise<void> {
    clearTimeout(this.timer);
    const done = new Promise<void>((resolve) => this.waiting.push(resolve));
    this.timer = setTimeout(() => {
      const waiting = this.waiting.splice(0);
      void this.load().finally(() => {
        for (const resolve of waiting) resolve();
      });
    }, delay);
    return done;
  }

  /** Called when a BPMN editor opens: explains once why workspace templates are missing. */
  async noticeRestrictedMode(): Promise<void> {
    if (vscode.workspace.isTrusted || this.restrictedNoticeShown) return;
    // Claimed before awaiting, so editors opening at the same time show it once.
    this.restrictedNoticeShown = true;
    // Listing names is fine in Restricted Mode; the files are not read.
    const found = await vscode.workspace.findFiles(TEMPLATE_GLOB, EXCLUDE, 1);
    if (found.length === 0) {
      this.restrictedNoticeShown = false;
      return;
    }
    this.log.info('Restricted Mode: element templates in this workspace are not loaded');
    const choice = await vscode.window.showInformationMessage(
      'Element templates in this workspace are not loaded in Restricted Mode.',
      'Manage Workspace Trust',
    );
    if (choice) await vscode.commands.executeCommand('workbench.trust.manage');
  }

  private async load(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      this.templates = empty();
      this.changed.fire();
      return;
    }
    try {
      const uris = await vscode.workspace.findFiles(
        TEMPLATE_GLOB,
        EXCLUDE,
        TEMPLATE_LIMITS.templates,
      );
      uris.sort((a, b) => a.path.localeCompare(b.path));
      const files: TemplateFile[] = [];
      const errors: string[] = [];
      for (const uri of uris) {
        const path = vscode.workspace.asRelativePath(uri);
        try {
          // Check the size before reading: a huge file is never loaded into memory.
          const { size } = await vscode.workspace.fs.stat(uri);
          if (size > TEMPLATE_LIMITS.fileBytes) {
            errors.push(`${path}: skipped, larger than ${TEMPLATE_LIMITS.fileBytes / 1024} KB`);
            continue;
          }
          files.push({
            path,
            text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
          });
        } catch (error) {
          errors.push(`${path}: ${String(error)}`);
        }
      }
      const result = collectTemplates(files);
      this.templates = result.templates;
      this.log.info(
        `Element templates: ${result.templates.c8.length} Camunda 8, ${result.templates.c7.length} Camunda 7 (${files.length} files)`,
      );
      for (const error of [...errors, ...result.errors]) this.log.warn(`Element template ${error}`);
    } catch (error) {
      this.log.error(`Loading element templates failed: ${String(error)}`);
    }
    this.changed.fire();
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const resolve of this.waiting.splice(0)) resolve();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
