import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Process Modeler', { log: true });
  context.subscriptions.push(log);

  context.subscriptions.push(
    vscode.commands.registerCommand('processModeler.showLog', () => {
      log.show();
    }),
  );

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`Activated ${context.extension.id} ${version}`);
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}
