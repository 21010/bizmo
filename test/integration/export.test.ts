// Image export (M7): the commands write the diagram as SVG or PNG; nothing is written for a file
// that is not open as a diagram.
import * as assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { TestingApi } from '../../src/extension/extension';

const EXTENSION_ID = '21010.bizmo';

let testing: TestingApi;
let fixtures: string;
let scratch: string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openDiagram(name: string): Promise<vscode.Uri> {
  const file = join(scratch, name);
  copyFileSync(join(fixtures, 'bpmn', name), file);
  const uri = vscode.Uri.file(file);
  await vscode.commands.executeCommand('vscode.openWith', uri, 'bizmo.bpmn');
  const start = Date.now();
  while (!testing.bpmnEditorStates().find((s) => s.uri === uri.toString() && s.lastImport?.ok)) {
    if (Date.now() - start > 20000) throw new Error('timeout waiting for the diagram');
    await sleep(100);
  }
  return uri;
}

describe('image export', function () {
  this.timeout(60000);

  before(async () => {
    const extension = vscode.extensions.getExtension<{ testing: TestingApi }>(EXTENSION_ID);
    assert.ok(extension);
    testing = (await extension.activate()).testing;
    fixtures = join(extension.extensionPath, 'test', 'fixtures');
  });

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bizmo-export-'));
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('exports the open diagram as SVG', async () => {
    const uri = await openDiagram('c8-order.bpmn');
    const target = vscode.Uri.file(join(scratch, 'order.svg'));
    const written = await vscode.commands.executeCommand<vscode.Uri | undefined>(
      'bizmo.bpmn.exportSvg',
      uri,
      target,
    );
    assert.equal(written?.fsPath, target.fsPath);
    const svg = readFileSync(target.fsPath, 'utf8');
    assert.match(svg, /<svg[\s>]/);
    assert.ok(svg.includes('Check stock'));
  });

  it('exports the open diagram as PNG', async () => {
    const uri = await openDiagram('c7-invoice.bpmn');
    const target = vscode.Uri.file(join(scratch, 'invoice.png'));
    await vscode.commands.executeCommand('bizmo.bpmn.exportPng', uri, target);
    const bytes = readFileSync(target.fsPath);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(bytes.length > 1000);
  });

  it('writes nothing for a file that is not open as a diagram', async () => {
    const uri = vscode.Uri.file(join(scratch, 'closed.bpmn'));
    const target = vscode.Uri.file(join(scratch, 'closed.svg'));
    const written = await vscode.commands.executeCommand('bizmo.bpmn.exportSvg', uri, target);
    assert.equal(written, undefined);
    assert.equal(existsSync(target.fsPath), false);
  });
});
