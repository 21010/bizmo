import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Bizmo', { log: true });
  context.subscriptions.push(log);

  context.subscriptions.push(
    vscode.commands.registerCommand('bizmo.showLog', () => {
      log.show();
    }),
  );

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`Activated ${context.extension.id} ${version}`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}
