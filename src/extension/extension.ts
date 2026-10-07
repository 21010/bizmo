import * as vscode from 'vscode';
import { newDiagramXml } from '../shared/bpmn/newDiagram';
import { newDmnXml } from '../shared/dmn/newDiagram';
import type { ExecutionPlatform, ImageFormat } from '../shared/protocol';
import type { EditorRegistry } from './core/editorRegistry';
import type { EditorState } from './core/editorSession';
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
  dmnEditorStates(): EditorState[];
  /** Reloads element templates now and resolves when done. */
  reloadElementTemplates(): Promise<void>;
}

/** What the commands shared by all notations need to know about one notation. */
interface Notation {
  /** Command id segment: `bizmo.<id>.openAsText`, … */
  id: string;
  viewType: string;
  /** Display name: "New BPMN Diagram (Camunda 8)". */
  name: string;
  /** File extension without the dot. */
  extension: string;
  editors: EditorRegistry;
  newXml(platform: ExecutionPlatform): string;
}

export function activate(context: vscode.ExtensionContext): { testing: TestingApi } | undefined {
  const log = vscode.window.createOutputChannel('Bizmo', { log: true });
  const templates = new ElementTemplateService(log);
  const bpmn = new BpmnEditorProvider(context.extensionUri, log, templates);
  const dmn = new DmnEditorProvider(context.extensionUri, log);
  const editorOptions = {
    webviewOptions: { retainContextWhenHidden: false },
    supportsMultipleEditorsPerDocument: true,
  };

  context.subscriptions.push(
    log,
    templates,
    bpmn,
    vscode.window.registerCustomEditorProvider(BPMN_VIEW_TYPE, bpmn, editorOptions),
    vscode.window.registerCustomEditorProvider(DMN_VIEW_TYPE, dmn, editorOptions),
    vscode.commands.registerCommand('bizmo.showLog', () => {
      log.show();
    }),
    vscode.commands.registerCommand(SHOW_PROBLEM_COMMAND, (uri: unknown, elementId: unknown) =>
      bpmn.showProblem(uri, elementId),
    ),
    ...notationCommands({
      id: 'bpmn',
      viewType: BPMN_VIEW_TYPE,
      name: 'BPMN',
      extension: 'bpmn',
      editors: bpmn.editors,
      newXml: newDiagramXml,
    }),
    ...notationCommands({
      id: 'dmn',
      viewType: DMN_VIEW_TYPE,
      name: 'DMN',
      extension: 'dmn',
      editors: dmn.editors,
      newXml: newDmnXml,
    }),
  );

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`Activated ${context.extension.id} ${version}`);

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      testing: {
        bpmnEditorStates: () => bpmn.editors.states(),
        dmnEditorStates: () => dmn.editors.states(),
        reloadElementTemplates: () => templates.reload(0),
      },
    };
  }
  return undefined;
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}

/** Open as Text / Open Diagram, image export, and new diagrams for one notation. */
function notationCommands(notation: Notation): vscode.Disposable[] {
  const command = (name: string, run: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(`bizmo.${notation.id}.${name}`, run);
  const exportImage = (format: ImageFormat, uri: unknown, target: unknown) => {
    const documentUri = uri instanceof vscode.Uri ? uri : activeCustomEditorUri(notation.viewType);
    if (!documentUri) return undefined;
    return notation.editors.exportImage(
      format,
      documentUri,
      target instanceof vscode.Uri ? target : undefined,
    );
  };
  return [
    command('openAsText', async (uri?: vscode.Uri) => {
      const target = uri ?? activeCustomEditorUri(notation.viewType);
      if (target) await reopenWith(target, TEXT_EDITOR);
    }),
    command('openDiagram', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await reopenWith(target, notation.viewType);
    }),
    // From the editor title menu VS Code passes the editor's resource; tests also pass a target.
    command('exportSvg', (uri?: unknown, target?: unknown) => exportImage('svg', uri, target)),
    command('exportPng', (uri?: unknown, target?: unknown) => exportImage('png', uri, target)),
    command('newDiagramC8', (target?: vscode.Uri) => createDiagram(notation, 'c8', target)),
    command('newDiagramC7', (target?: vscode.Uri) => createDiagram(notation, 'c7', target)),
  ];
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
async function createDiagram(
  notation: Notation,
  platform: ExecutionPlatform,
  target?: vscode.Uri,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri =
    target ??
    (await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, `diagram.${notation.extension}`) : undefined,
      filters: { [`${notation.name} diagram`]: [notation.extension] },
      saveLabel: 'Create Diagram',
      title: `New ${notation.name} Diagram (${platform === 'c8' ? 'Camunda 8' : 'Camunda 7'})`,
    }));
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(notation.newXml(platform)));
  await vscode.commands.executeCommand('vscode.openWith', uri, notation.viewType);
}
