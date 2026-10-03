// BPMN linting → VS Code diagnostics (M6): problems from the diagram editor appear in the Problems
// view at the element's id, follow the user setting, and link back to the element.
import * as assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { TestingApi } from '../../src/extension/extension';
import type { BpmnEditorState } from '../../src/extension/notations/bpmn/bpmnEditorProvider';

const EXTENSION_ID = '21010.bizmo';

let testing: TestingApi;
let fixtures: string;

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

const bizmoDiagnostics = (uri: vscode.Uri) =>
  vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Bizmo');

/** Opens a copy of a fixture in the diagram editor and waits for its first lint result. */
async function openCopy(name: string): Promise<vscode.Uri> {
  const file = join(mkdtempSync(join(tmpdir(), 'bizmo-lint-')), name);
  copyFileSync(join(fixtures, 'bpmn', name), file);
  const uri = vscode.Uri.file(file);
  await vscode.commands.executeCommand('vscode.openWith', uri, 'bizmo.bpmn');
  await poll(() => stateOf(uri)?.lintProblems, 'lint result');
  return uri;
}

const setLinting = (enabled: boolean | undefined) =>
  vscode.workspace
    .getConfiguration('bizmo')
    .update('bpmn.linting.enabled', enabled, vscode.ConfigurationTarget.Global);

describe('BPMN linting', function () {
  this.timeout(60000);

  before(async () => {
    const extension = vscode.extensions.getExtension<{ testing: TestingApi }>(EXTENSION_ID);
    assert.ok(extension);
    testing = (await extension.activate()).testing;
    fixtures = join(extension.extensionPath, 'test', 'fixtures');
  });

  afterEach(async () => {
    await setLinting(undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it("shows problems in the Problems view at the element's id, linking to the element", async () => {
    const uri = await openCopy('c8-lint.bpmn');
    const [diagnostic, ...others] = await poll(() => {
      const found = bizmoDiagnostics(uri);
      return found.length > 0 ? found : undefined;
    }, 'diagnostics');
    assert.equal(others.length, 0);
    assert.ok(diagnostic);
    assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(
      diagnostic.message,
      'A <Service Task> must have a <Task definition type> (Task_NoType)',
    );
    const document = await vscode.workspace.openTextDocument(uri);
    assert.equal(document.getText(diagnostic.range), 'Task_NoType');
    assert.ok(typeof diagnostic.code === 'object');
    assert.equal(diagnostic.code.value, 'camunda-compat/implementation');
    assert.equal(diagnostic.code.target.scheme, 'command');
    assert.equal(diagnostic.code.target.path, 'bizmo.bpmn.showProblem');
    // VS Code passes these as the command's arguments (the query is JSON).
    const args = JSON.parse(decodeURIComponent(diagnostic.code.target.query)) as unknown[];
    assert.equal(args.length, 2);
    assert.equal(vscode.Uri.parse(String(args[0])).toString(), uri.toString());
    assert.equal(args[1], 'Task_NoType');
  });

  it("the problem's link reveals the element in the open diagram", async () => {
    const uri = await openCopy('c8-lint.bpmn');
    await poll(() => bizmoDiagnostics(uri).length > 0, 'diagnostics');
    await vscode.commands.executeCommand('bizmo.bpmn.showProblem', uri.toString(), 'Task_NoType');
    assert.equal(stateOf(uri)?.lastReveal, 'Task_NoType');
  });

  it('the link command ignores documents without Bizmo problems and malformed arguments', async () => {
    const uri = await openCopy('c8-order.bpmn');
    const other = await openCopy('c7-invoice.bpmn'); // no problems
    await vscode.commands.executeCommand('bizmo.bpmn.showProblem', other.toString(), 'Task_Book');
    assert.equal(stateOf(other)?.lastReveal, undefined);
    for (const args of [[uri.toString()], [42, 'Task_Ship'], [uri.toString(), 'x'.repeat(500)]]) {
      await vscode.commands.executeCommand('bizmo.bpmn.showProblem', ...args);
    }
    assert.equal(stateOf(uri)?.lastReveal, undefined);
  });

  it('turning linting off clears the problems; turning it on brings them back', async () => {
    const uri = await openCopy('c8-lint.bpmn');
    await poll(() => bizmoDiagnostics(uri).length === 1, 'diagnostics');
    await setLinting(false);
    await poll(() => bizmoDiagnostics(uri).length === 0, 'diagnostics cleared');
    await sleep(1000);
    assert.equal(bizmoDiagnostics(uri).length, 0, 'stays clear while off');
    await setLinting(true);
    await poll(() => bizmoDiagnostics(uri).length === 1, 'diagnostics back');
  });

  it('clears the problems when the last diagram editor of the file closes', async () => {
    const uri = await openCopy('c8-lint.bpmn');
    await poll(() => bizmoDiagnostics(uri).length === 1, 'diagnostics');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await poll(() => bizmoDiagnostics(uri).length === 0, 'diagnostics cleared');
  });
});
