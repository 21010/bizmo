import * as assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { TestingApi } from '../../src/extension/extension';
import type { BpmnEditorState } from '../../src/extension/notations/bpmn/bpmnEditorProvider';

const EXTENSION_ID = '21010.bizmo';
const VIEW_TYPE = 'bizmo.bpmn';

let testing: TestingApi;
let fixtures: string;
let scratch: string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll<T>(
  probe: () => T | undefined | false,
  label: string,
  timeout = 20000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(100);
  }
}

const stateOf = (uri: vscode.Uri): BpmnEditorState | undefined =>
  testing.bpmnEditorStates().find((s) => s.uri === uri.toString());

const activeInput = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;

/** Copies a fixture into a scratch folder so tests never touch the originals. */
function scratchCopy(name: string): vscode.Uri {
  const target = join(scratch, `${String(Date.now())}-${name}`);
  copyFileSync(join(fixtures, name), target);
  return vscode.Uri.file(target);
}

async function openDiagram(uri: vscode.Uri): Promise<BpmnEditorState> {
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  return poll(() => {
    const state = stateOf(uri);
    return state && (state.lastImport ?? state.rejected) ? state : undefined;
  }, `diagram result for ${uri.fsPath}`);
}

describe('BPMN editor (M2 read-only viewer)', function () {
  this.timeout(60000);

  before(async () => {
    const extension = vscode.extensions.getExtension<{ testing: TestingApi }>(EXTENSION_ID);
    assert.ok(extension);
    testing = (await extension.activate()).testing;
    fixtures = join(extension.extensionPath, 'test', 'fixtures', 'bpmn');
    scratch = mkdtempSync(join(tmpdir(), 'bizmo-it-'));
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace.getConfiguration('bizmo').update('maxFileSizeMB', undefined, true);
  });

  it('is the default editor for .bpmn files', async () => {
    const uri = scratchCopy('c8-order.bpmn');
    await vscode.commands.executeCommand('vscode.open', uri);
    const input = await poll(() => {
      const current = activeInput();
      return current instanceof vscode.TabInputCustom ? current : undefined;
    }, 'custom editor tab');
    assert.equal(input.viewType, VIEW_TYPE);
  });

  for (const [name, minElements] of [
    ['c8-order.bpmn', 10],
    ['c7-invoice.bpmn', 8],
    ['bom-crlf.bpmn', 10],
  ] as const) {
    it(`renders ${name} without CSP violations and never writes`, async () => {
      const uri = scratchCopy(name);
      const before = readFileSync(uri.fsPath);
      const state = await openDiagram(uri);
      assert.equal(state.lastImport?.ok, true);
      assert.ok(state.lastImport.elementCount >= minElements);
      await sleep(1000);
      assert.equal(stateOf(uri)?.cspViolations, 0);
      assert.equal(stateOf(uri)?.droppedMessages, 0);
      const document = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString(),
      );
      assert.equal(document?.isDirty, false);
      assert.deepEqual(readFileSync(uri.fsPath), before, 'file bytes unchanged');
    });
  }

  it('blocks DOCTYPE documents before they reach the webview', async () => {
    const state = await openDiagram(scratchCopy('doctype-xxe.bpmn'));
    assert.equal(state.rejected, 'doctype');
    assert.equal(state.lastImport, undefined);
  });

  it('rejects files above the size limit', async () => {
    await vscode.workspace.getConfiguration('bizmo').update('maxFileSizeMB', 1, true);
    const target = join(scratch, 'large.bpmn');
    const padding = `<!-- ${'x'.repeat(1.5 * 1024 * 1024)} -->`;
    writeFileSync(
      target,
      readFileSync(join(fixtures, 'c8-order.bpmn'), 'utf8').replace(
        '</bpmn:definitions>',
        `${padding}</bpmn:definitions>`,
      ),
    );
    const state = await openDiagram(vscode.Uri.file(target));
    assert.equal(state.rejected, 'tooLarge');
  });

  it('reports invalid XML as a failed import', async () => {
    const state = await openDiagram(scratchCopy('truncated.bpmn'));
    assert.equal(state.lastImport?.ok, false);
  });

  it('re-renders after an external change', async () => {
    const uri = scratchCopy('no-platform.bpmn');
    await openDiagram(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      document.getText().replace('Do the work', 'Do other work'),
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
    const state = await poll(() => {
      const s = stateOf(uri);
      return s?.lastImport?.version === document.version ? s : undefined;
    }, 're-import after external change');
    assert.equal(state.lastImport?.ok, true);
  });

  it('"Open as Text" and "Open Diagram" switch the editor in place', async () => {
    const uri = scratchCopy('c8-order.bpmn');
    const tabsFor = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => {
          const input = tab.input;
          return (
            (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) &&
            input.uri.toString() === uri.toString()
          );
        });

    await openDiagram(uri);
    await vscode.commands.executeCommand('bizmo.bpmn.openAsText');
    await poll(() => activeInput() instanceof vscode.TabInputText, 'text editor');
    await poll(() => tabsFor().length === 1, 'diagram tab replaced by the text tab');

    await vscode.commands.executeCommand('bizmo.bpmn.openDiagram');
    await poll(() => {
      const input = activeInput();
      return input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE;
    }, 'diagram editor');
    await poll(() => tabsFor().length === 1, 'text tab replaced by the diagram tab');
  });
});
