// Element templates from the workspace (ADR 0010, D4): loaded in a trusted workspace, sent to the
// editor, and reloaded when template files change.
import * as assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { TestingApi } from '../../src/extension/extension';
import type { BpmnEditorState } from '../../src/extension/notations/bpmn/bpmnEditorProvider';

const EXTENSION_ID = '21010.bizmo';

let testing: TestingApi;
let fixtures: string;
let templatesDir: string;

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

describe('element templates', function () {
  this.timeout(60000);

  before(async () => {
    const extension = vscode.extensions.getExtension<{ testing: TestingApi }>(EXTENSION_ID);
    assert.ok(extension);
    testing = (await extension.activate()).testing;
    fixtures = join(extension.extensionPath, 'test', 'fixtures');
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace, 'tests run with a workspace folder');
    templatesDir = join(workspace.uri.fsPath, '.camunda', 'element-templates');
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('runs in a trusted workspace', () => {
    assert.equal(vscode.workspace.isTrusted, true);
  });

  it('sends the workspace templates for both platforms to the editor', async () => {
    await testing.reloadElementTemplates();
    const scratch = mkdtempSync(join(tmpdir(), 'bizmo-tpl-'));
    const diagram = join(scratch, 'templated.bpmn');
    copyFileSync(join(fixtures, 'bpmn', 'c8-templated.bpmn'), diagram);
    const uri = vscode.Uri.file(diagram);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'bizmo.bpmn');

    const state = await poll(() => {
      const s = stateOf(uri);
      return s?.lastImport && s.templatesSent ? s : undefined;
    }, 'templates sent');
    assert.deepEqual(state.templatesSent, { c7: 1, c8: 1 });
    assert.equal(state.templateErrors, 0);
  });

  it('reloads when a template file is added or removed', async () => {
    await testing.reloadElementTemplates();
    const scratch = mkdtempSync(join(tmpdir(), 'bizmo-tpl-'));
    const diagram = join(scratch, 'templated.bpmn');
    copyFileSync(join(fixtures, 'bpmn', 'c8-templated.bpmn'), diagram);
    const uri = vscode.Uri.file(diagram);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'bizmo.bpmn');
    await poll(() => stateOf(uri)?.templatesSent?.c8 === 1, 'initial templates');

    const added = join(templatesDir, 'added.c8.json');
    const template = {
      $schema:
        'https://unpkg.com/@camunda/zeebe-element-templates-json-schema/resources/schema.json',
      name: 'Added later',
      id: 'io.bizmo.test.added',
      version: 1,
      appliesTo: ['bpmn:Task'],
      properties: [],
    };
    try {
      writeFileSync(added, JSON.stringify(template));
      await poll(() => stateOf(uri)?.templatesSent?.c8 === 2, 'template added (file watcher)');
    } finally {
      rmSync(added, { force: true });
    }
    await poll(() => stateOf(uri)?.templatesSent?.c8 === 1, 'template removed (file watcher)');
  });
});
