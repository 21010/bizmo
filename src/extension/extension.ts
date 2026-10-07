import * as vscode from 'vscode';
import { newDiagramXml } from '../shared/bpmn/newDiagram';
import type { ExecutionPlatform, ImageFormat } from '../shared/protocol';
import { reopenWith, TEXT_EDITOR } from './core/reopen';
import {
  BPMN_VIEW_TYPE,
  BpmnEditorProvider,
  SHOW_PROBLEM_COMMAND,
  type BpmnEditorState,
} from './notations/bpmn/bpmnEditorProvider';
import { ElementTemplateService } from './notations/bpmn/elementTemplateService';
import { DMN_VIEW_TYPE, DmnEditorProvider } from './notations/dmn/dmnEditorProvider';

/** Returned from `activate` only in test mode, so integration tests can observe editor state. */
export interface TestingApi {
  bpmnEditorStates(): BpmnEditorState[];
  /** Reloads element templates now and resolves when done. */
  reloadElementTemplates(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): { testing: TestingApi } | undefined {
  const log = vscode.window.createOutputChannel('Bizmo', { log: true });
  const templates = new ElementTemplateService(log);
  const bpmn = new BpmnEditorProvider(context.extensionUri, log, templates);
  const dmn = new DmnEditorProvider(context.extensionUri, log);

  context.subscriptions.push(
    log,
    templates,
    bpmn,
    vscode.window.registerCustomEditorProvider(BPMN_VIEW_TYPE, bpmn, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.window.registerCustomEditorProvider(DMN_VIEW_TYPE, dmn, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('bizmo.showLog', () => {
      log.show();
    }),
    vscode.commands.registerCommand('bizmo.bpmn.openAsText', async (uri?: vscode.Uri) => {
      const target = uri ?? activeCustomEditorUri(BPMN_VIEW_TYPE);
      if (target) await reopenWith(target, TEXT_EDITOR);
    }),
    vscode.commands.registerCommand('bizmo.bpmn.openDiagram', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await reopenWith(target, BPMN_VIEW_TYPE);
    }),
    // From the editor title menu VS Code passes the editor's resource; tests also pass a target.
    vscode.commands.registerCommand('bizmo.bpmn.exportSvg', (uri?: unknown, target?: unknown) =>
      exportImage('svg', uri, target),
    ),
    vscode.commands.registerCommand('bizmo.bpmn.exportPng', (uri?: unknown, target?: unknown) =>
      exportImage('png', uri, target),
    ),
    vscode.commands.registerCommand(SHOW_PROBLEM_COMMAND, (uri: unknown, elementId: unknown) =>
      bpmn.showProblem(uri, elementId),
    ),
    vscode.commands.registerCommand('bizmo.bpmn.newDiagramC8', (target?: vscode.Uri) =>
      createDiagram('c8', target),
    ),
    vscode.commands.registerCommand('bizmo.bpmn.newDiagramC7', (target?: vscode.Uri) =>
      createDiagram('c7', target),
    ),
  );

  async function exportImage(format: ImageFormat, uri: unknown, target: unknown) {
    const documentUri = uri instanceof vscode.Uri ? uri : activeCustomEditorUri(BPMN_VIEW_TYPE);
    if (!documentUri) return undefined;
    return bpmn.exportImage(format, documentUri, target instanceof vscode.Uri ? target : undefined);
  }

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`Activated ${context.extension.id} ${version}`);

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      testing: {
        bpmnEditorStates: () => [...bpmn.states],
        reloadElementTemplates: () => templates.reload(0),
      },
    };
  }
  return undefined;
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

function activeCustomEditorUri(viewType: string): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom && input.viewType === viewType
    ? input.uri
    : undefined;
}

/**
 * Creates a new diagram file and opens it in the modeler. `target` skips the save dialog
 * (used by tests and other commands); otherwise the user picks the location.
 */
async function createDiagram(platform: ExecutionPlatform, target?: vscode.Uri): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri =
    target ??
    (await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, 'diagram.bpmn') : undefined,
      filters: { 'BPMN diagram': ['bpmn'] },
      saveLabel: 'Create Diagram',
      title: `New BPMN Diagram (${platform === 'c8' ? 'Camunda 8' : 'Camunda 7'})`,
    }));
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(newDiagramXml(platform)));
  await vscode.commands.executeCommand('vscode.openWith', uri, BPMN_VIEW_TYPE);
}
