import * as vscode from 'vscode';
import { reopenWith, TEXT_EDITOR } from './core/reopen';
import {
  BPMN_VIEW_TYPE,
  BpmnEditorProvider,
  type BpmnEditorState,
} from './notations/bpmn/bpmnEditorProvider';

/** Returned from `activate` only in test mode, so integration tests can observe editor state. */
export interface TestingApi {
  bpmnEditorStates(): BpmnEditorState[];
}

export function activate(context: vscode.ExtensionContext): { testing: TestingApi } | undefined {
  const log = vscode.window.createOutputChannel('Bizmo', { log: true });
  const bpmn = new BpmnEditorProvider(context.extensionUri, log);

  context.subscriptions.push(
    log,
    vscode.window.registerCustomEditorProvider(BPMN_VIEW_TYPE, bpmn, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: false,
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
  );

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`Activated ${context.extension.id} ${version}`);

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return { testing: { bpmnEditorStates: () => [...bpmn.states.values()] } };
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
