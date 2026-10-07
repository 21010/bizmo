// DMN editor (ADR 0014) in VS Code: default editor, rendering without writes (also for DMN 1.1),
// host checks, sync with the document, text/diagram switching, new diagrams, and image export.
import * as assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { EditorState } from '../../src/extension/core/editorSession';
import type { TestingApi } from '../../src/extension/extension';

const EXTENSION_ID = '21010.bizmo';
const VIEW_TYPE = 'bizmo.dmn';

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

const statesOf = (uri: vscode.Uri): EditorState[] =>
  testing.dmnEditorStates().filter((s) => s.uri === uri.toString());
const stateOf = (uri: vscode.Uri): EditorState | undefined => statesOf(uri)[0];
const documentOf = (uri: vscode.Uri) =>
  vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
const activeInput = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;

/** Copies a fixture into a scratch folder so tests never touch the originals. */
function scratchCopy(name: string): vscode.Uri {
  const target = join(scratch, `${String(Date.now())}-${name}`);
  copyFileSync(join(fixtures, name), target);
  return vscode.Uri.file(target);
}

async function openDiagram(uri: vscode.Uri): Promise<EditorState> {
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  return poll(() => {
    const state = stateOf(uri);
    return state && (state.lastImport ?? state.rejected) ? state : undefined;
  }, `diagram result for ${uri.fsPath}`);
}

async function replaceAll(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
  assert.ok(await vscode.workspace.applyEdit(edit));
}

describe('DMN editor', function () {
  this.timeout(60000);

  before(async () => {
    const extension = vscode.extensions.getExtension<{ testing: TestingApi }>(EXTENSION_ID);
    assert.ok(extension);
    testing = (await extension.activate()).testing;
    fixtures = join(extension.extensionPath, 'test', 'fixtures', 'dmn');
    scratch = mkdtempSync(join(tmpdir(), 'bizmo-dmn-it-'));
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('is the default editor for .dmn files', async () => {
    await vscode.commands.executeCommand('vscode.open', scratchCopy('c8-dish.dmn'));
    const input = await poll(() => {
      const current = activeInput();
      return current instanceof vscode.TabInputCustom ? current : undefined;
    }, 'custom editor tab');
    assert.equal(input.viewType, VIEW_TYPE);
  });

  for (const [name, elements] of [
    ['c8-dish.dmn', 2],
    ['c7-dish.dmn', 2],
    // Migrated to DMN 1.3 for display only: the document must not change (ADR 0014, decision 4).
    ['c7-dmn11.dmn', 1],
    ['c7-dmn12.dmn', 1],
  ] as const) {
    it(`renders ${name} without CSP violations and never writes`, async () => {
      const uri = scratchCopy(name);
      const before = readFileSync(uri.fsPath);
      const state = await openDiagram(uri);
      assert.equal(state.lastImport?.ok, true);
      assert.equal(state.lastImport.elementCount, elements);
      await sleep(1000);
      assert.equal(stateOf(uri)?.cspViolations, 0);
      assert.equal(stateOf(uri)?.droppedMessages, 0);
      assert.equal(documentOf(uri)?.isDirty, false);
      assert.deepEqual(readFileSync(uri.fsPath), before, 'file bytes unchanged');
    });
  }

  it('blocks DOCTYPE documents before they reach the webview', async () => {
    const target = join(scratch, 'doctype.dmn');
    writeFileSync(
      target,
      readFileSync(join(fixtures, 'c8-dish.dmn'), 'utf8').replace(
        '<definitions',
        '<!DOCTYPE definitions [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n<definitions',
      ),
    );
    const state = await openDiagram(vscode.Uri.file(target));
    assert.equal(state.rejected, 'doctype');
    assert.equal(state.lastImport, undefined);
  });

  it('reports invalid XML as a failed import', async () => {
    const target = join(scratch, 'truncated.dmn');
    writeFileSync(target, readFileSync(join(fixtures, 'c8-dish.dmn'), 'utf8').slice(0, 600));
    const state = await openDiagram(vscode.Uri.file(target));
    assert.equal(state.lastImport?.ok, false);
  });

  it('re-renders after an external change, and after revert', async () => {
    const uri = scratchCopy('c8-dish.dmn');
    await openDiagram(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    await replaceAll(document, document.getText().replace('"Salad"', '"Soup"'));
    await poll(() => stateOf(uri)?.lastImport?.version === document.version, 'external change');
    assert.equal(stateOf(uri)?.lastImport?.ok, true);

    await vscode.commands.executeCommand('workbench.action.files.revert');
    await poll(() => !document.isDirty, 'reverted');
    await poll(() => stateOf(uri)?.lastImport?.version === document.version, 'after revert');
    assert.ok(document.getText().includes('"Salad"'));
  });

  it('keeps two diagram editors of one document in sync', async () => {
    const uri = scratchCopy('c8-dish.dmn');
    await openDiagram(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, vscode.ViewColumn.Two);
    await poll(() => statesOf(uri).filter((s) => s.lastImport?.ok).length === 2, 'two editors');
    const document = await vscode.workspace.openTextDocument(uri);
    await replaceAll(document, document.getText().replace('"Salad"', '"Soup"'));
    await poll(
      () => statesOf(uri).every((s) => s.lastImport?.version === document.version),
      'both editors re-rendered',
    );
  });

  it('saves promptly: the webview answers the pre-save flush', async () => {
    const uri = scratchCopy('c8-dish.dmn');
    await openDiagram(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    await replaceAll(document, document.getText().replace('"Salad"', '"Soup"'));
    await poll(() => stateOf(uri)?.lastImport?.version === document.version, 're-render');
    const started = Date.now();
    assert.ok(await document.save());
    assert.ok(Date.now() - started < 1500, 'answered by the webview, not by the flush timeout');
    assert.ok(readFileSync(uri.fsPath, 'utf8').includes('"Soup"'));
  });

  it('"Open as Text" and "Open Diagram" switch the editor in place', async () => {
    const uri = scratchCopy('c8-dish.dmn');
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
    await vscode.commands.executeCommand('bizmo.dmn.openAsText');
    await poll(() => activeInput() instanceof vscode.TabInputText, 'text editor');
    await poll(() => tabsFor().length === 1, 'diagram tab replaced by the text tab');
    await vscode.commands.executeCommand('bizmo.dmn.openDiagram');
    await poll(() => {
      const input = activeInput();
      return input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE;
    }, 'diagram editor');
    await poll(() => tabsFor().length === 1, 'text tab replaced by the diagram tab');
  });

  it('creates new Camunda 8 and Camunda 7 DMN diagrams that render and are not dirty', async () => {
    for (const [command, platform] of [
      ['bizmo.dmn.newDiagramC8', 'Camunda Cloud'],
      ['bizmo.dmn.newDiagramC7', 'Camunda Platform'],
    ] as const) {
      const uri = vscode.Uri.file(join(scratch, `${String(Date.now())}-new.dmn`));
      await vscode.commands.executeCommand(command, uri);
      const result = await poll(() => stateOf(uri)?.lastImport, `${command} import`);
      assert.equal(result.ok, true);
      assert.ok(result.ok && result.elementCount === 1);
      assert.ok(
        readFileSync(uri.fsPath, 'utf8').includes(`modeler:executionPlatform="${platform}"`),
      );
      await sleep(500);
      assert.equal(documentOf(uri)?.isDirty, false);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  describe('image export', () => {
    it('exports the DRD as SVG and PNG', async () => {
      const uri = scratchCopy('c8-dish.dmn');
      await openDiagram(uri);
      const svgTarget = vscode.Uri.file(join(scratch, 'dish.svg'));
      const written = await vscode.commands.executeCommand<vscode.Uri | undefined>(
        'bizmo.dmn.exportSvg',
        uri,
        svgTarget,
      );
      assert.equal(written?.fsPath, svgTarget.fsPath);
      const svg = readFileSync(svgTarget.fsPath, 'utf8');
      assert.match(svg, /<svg[\s>]/);
      assert.ok(svg.includes('Season'));

      const pngTarget = vscode.Uri.file(join(scratch, 'dish.png'));
      await vscode.commands.executeCommand('bizmo.dmn.exportPng', uri, pngTarget);
      const bytes = readFileSync(pngTarget.fsPath);
      assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    });

    it('writes nothing for a file without a DRD', async () => {
      const uri = scratchCopy('c7-dmn11.dmn');
      await openDiagram(uri);
      const target = vscode.Uri.file(join(scratch, 'old.svg'));
      const written = await vscode.commands.executeCommand('bizmo.dmn.exportSvg', uri, target);
      assert.equal(written, undefined);
      assert.equal(existsSync(target.fsPath), false);
    });
  });
});
