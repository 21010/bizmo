import * as vscode from 'vscode';

/** The id VS Code uses for its built-in text editor in `vscode.openWith`. */
export const TEXT_EDITOR = 'default';

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}

function tabEditor(tab: vscode.Tab): string | undefined {
  if (tab.input instanceof vscode.TabInputText) return TEXT_EDITOR;
  if (tab.input instanceof vscode.TabInputCustom) return tab.input.viewType;
  return undefined;
}

/**
 * Reopens a resource with another editor in place, like VS Code's "Reopen Editor With…": the
 * tab showing it with the other editor is closed. The document stays open in the new editor.
 */
export async function reopenWith(uri: vscode.Uri, viewType: string): Promise<void> {
  const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType, column);
  const group = vscode.window.tabGroups.activeTabGroup;
  const replaced = group.tabs.filter(
    (tab) =>
      !tab.isActive &&
      tabUri(tab)?.toString() === uri.toString() &&
      tabEditor(tab) !== undefined &&
      tabEditor(tab) !== viewType,
  );
  if (replaced.length > 0) await vscode.window.tabGroups.close(replaced, true);
}
