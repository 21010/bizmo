// Integration tests for the M1 spike prototype, run inside real VS Code.
const assert = require('node:assert/strict');
const vscode = require('vscode');

const ws = () => vscode.workspace.workspaceFolders[0].uri;
const file = (name) => vscode.Uri.joinPath(ws(), name);
const state = () => vscode.commands.executeCommand('bizmoSpike.state');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, label, timeout = 30000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) {
      throw new Error(`timeout waiting for ${label}: ${JSON.stringify((await state()).imports.slice(-6))}`);
    }
    await sleep(100);
  }
}

/** Waits for an import of this file matching the predicate; returns that import record. */
const waitImport = (name, pred, label) =>
  poll(async () => (await state()).imports.filter((i) => i.uri === name).find(pred), label);

const updateFor = (doc) => (i) => i.reason === 'update' && i.version === doc.version;

let counter = 0;
/** Opens a fresh copy of a fixture so tests never share document state. */
async function open(fixture) {
  const name = `${fixture.replace('.bpmn', '')}-${++counter}.bpmn`;
  await vscode.workspace.fs.copy(file(fixture), file(name));
  const doc = await vscode.workspace.openTextDocument(file(name));
  const original = doc.getText();
  await vscode.commands.executeCommand('vscode.openWith', file(name), 'bizmoSpike.bpmn');
  const imported = await waitImport(name, (i) => i.reason === 'init', `initial import of ${name}`);
  return { name, doc, original, imported };
}

async function replaceAll(doc, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
  await vscode.workspace.applyEdit(edit);
}

suite('M1 spike: text-backed custom editor with camunda-bpmn-js', function () {
  this.timeout(120000);

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('S1: C8 diagram renders inside a real VS Code webview with zero CSP violations; opening never writes', async () => {
    const { doc, original, imported } = await open('c8.bpmn');
    assert.equal(imported.error, undefined);
    assert.ok(imported.elements > 3);
    await sleep(1500);
    const s = await state();
    assert.deepEqual(s.violations, []);
    assert.deepEqual(s.errors, []);
    assert.equal(doc.isDirty, false);
    assert.equal(doc.getText(), original);
  });

  test('S1: C7 diagram renders with zero CSP violations', async () => {
    const { imported } = await open('c7.bpmn');
    assert.equal(imported.error, undefined);
    await sleep(1000);
    assert.deepEqual((await state()).violations, []);
  });

  test('S2: edit → document; echo suppressed; VS Code undo/redo revert and re-apply; webview follows', async () => {
    const { name, doc, original } = await open('c8.bpmn');
    await vscode.commands.executeCommand('bizmoSpike.op', 'appendTask');
    await poll(() => /<bpmn:task /.test(doc.getText()), 'edit applied to document');
    assert.equal(doc.isDirty, true);
    await sleep(800);
    const echoes = (await state()).imports.filter((i) => i.uri === name && i.reason === 'update');
    assert.deepEqual(echoes, [], 'own edit must not trigger a re-import');

    await vscode.commands.executeCommand('undo');
    await poll(() => doc.getText() === original, 'undo restores the original text exactly');
    const afterUndo = await waitImport(name, updateFor(doc), 're-import after undo');
    assert.equal(afterUndo.error, undefined);

    await vscode.commands.executeCommand('redo');
    await poll(() => /<bpmn:task /.test(doc.getText()), 'redo re-applies the edit');
    await waitImport(name, updateFor(doc), 're-import after redo');
    const s = await state();
    console.log(`      echoes suppressed: ${s.echoesSuppressed}, rejected stale edits: ${s.rejectedEdits}`);
  });

  test('S2: external change updates the webview and preserves the viewport', async () => {
    const { name, doc } = await open('c8.bpmn');
    await vscode.commands.executeCommand('bizmoSpike.op', 'zoom');
    await sleep(300);
    await replaceAll(doc, doc.getText().replace(/(<bpmn:startEvent id="[^"]+")/, '$1 name="Changed externally"'));
    const i = await waitImport(name, updateFor(doc), 're-import after external change');
    assert.equal(i.error, undefined);
    assert.equal(i.viewRestored, true);
  });

  test('S2: an invalid external change shows an error, and a later valid change recovers', async () => {
    const { name, doc, original } = await open('c8.bpmn');
    await replaceAll(doc, original.slice(0, 300));
    const bad = await waitImport(name, updateFor(doc), 'failed import');
    assert.ok(bad.error, 'import of truncated XML fails');
    await replaceAll(doc, original);
    const good = await waitImport(name, updateFor(doc), 'recovery import');
    assert.equal(good.error, undefined);
  });

  test('S3: CRLF documents keep CRLF line endings after an edit', async () => {
    const { doc } = await open('crlf.bpmn');
    assert.equal(doc.eol, vscode.EndOfLine.CRLF);
    await vscode.commands.executeCommand('bizmoSpike.op', 'appendTask');
    await poll(() => /<bpmn:task /.test(doc.getText()), 'edit applied');
    assert.equal(doc.eol, vscode.EndOfLine.CRLF);
    assert.equal(/[^\r]\n/.test(doc.getText()), false, 'no bare LF line endings');
  });

  test('S2: re-import cost of a 500-task diagram inside VS Code', async () => {
    const { name, doc, imported } = await open('big500.bpmn');
    await replaceAll(doc, doc.getText().replace('name="Task 1"', 'name="Task one"'));
    const i = await waitImport(name, updateFor(doc), 'big re-import');
    console.log(`      big500: ${imported.elements} elements, initial import ${imported.ms} ms, re-import ${i.ms} ms`);
    assert.ok(i.ms < 3000);
  });
});
