import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = '21010.bizmo';

describe('extension activation', () => {
  it('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} is installed`);

    await extension.activate();

    assert.equal(extension.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('bizmo.showLog'));
  });

  it('registers every command it contributes', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const manifest = extension.packageJSON as { contributes: { commands: { command: string }[] } };
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = manifest.contributes.commands
      .map(({ command }) => command)
      .filter((command) => !registered.has(command));
    assert.deepEqual(missing, []);
  });
});
