// Shared helpers for end-to-end tests: real VS Code (Electron) driven by Playwright with trusted
// mouse and keyboard input.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron, type ElectronApplication, type Frame, type Page } from 'playwright';
import { expect } from 'vitest';

const REPO = resolve('.');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** VS Code's default shortcuts per platform. */
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
export const keys = {
  close: `${mod}+W`,
  undo: `${mod}+Z`,
  redo: process.platform === 'win32' ? 'Control+Y' : `${mod}+Shift+Z`,
  save: `${mod}+S`,
  copy: `${mod}+C`,
  paste: `${mod}+V`,
};

export interface VsCode {
  app: ElectronApplication;
  win: Page;
  workspace: string;
  userData: string;
}

/**
 * Launches VS Code with this extension on a fresh workspace and user profile. With
 * `workspaceTrust: true`, workspace trust is enabled; extra user `settings` are merged in.
 */
export async function launchVsCode(options: {
  workspace: string;
  workspaceTrust?: boolean;
  settings?: Record<string, unknown>;
}): Promise<VsCode> {
  const executablePath = await downloadAndUnzipVSCode(
    process.env['VSCODE_TEST_VERSION'] ?? 'stable',
  );
  const userData = mkdtempSync(join(tmpdir(), 'bizmo-e2e-user-'));
  mkdirSync(join(userData, 'User'));
  writeFileSync(
    join(userData, 'User', 'settings.json'),
    JSON.stringify({
      'chat.disableAIFeatures': true,
      'workbench.startupEditor': 'none',
      'files.autoSave': 'off',
      // A real default layout: no empty secondary side bar taking a third of the window.
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      ...options.settings,
    }),
  );
  const app = await electron.launch({
    executablePath,
    args: [
      `--extensionDevelopmentPath=${REPO}`,
      options.workspace,
      '--disable-extensions',
      ...(options.workspaceTrust ? [] : ['--disable-workspace-trust']),
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${userData}`,
    ],
  });
  const win = await app.firstWindow();
  // Same size as CI runners' default screen, so local runs see the layout CI sees.
  // (Typed locally: the part of Electron's main-process API used here.)
  interface ElectronMain {
    BrowserWindow: { getAllWindows(): { setSize(width: number, height: number): void }[] };
  }
  await app.evaluate(({ BrowserWindow }: ElectronMain) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1024, 768);
  });
  return { app, win, workspace: options.workspace, userData };
}

export const dirtyTabs = (win: Page) => win.locator('.tabs-container .tab.dirty').count();

/** Opens a file from the Explorer and returns the webview frame showing the diagram. */
export async function openFromExplorer(win: Page, name: string): Promise<Frame> {
  const item = win.getByRole('treeitem', { name });
  await item.waitFor();
  for (let attempt = 0; attempt < 20; attempt++) {
    await item.click();
    for (let i = 0; i < 20; i++) {
      for (const frame of win.frames()) {
        if (
          await frame
            .locator('.djs-container')
            .count()
            .catch(() => 0)
        )
          return frame;
      }
      await sleep(250);
    }
    // Clicked before VS Code registered Bizmo's editor (start-up): close the text editor and retry.
    await win.keyboard.press(keys.close);
  }
  throw new Error('diagram editor did not open');
}

export const element = (frame: Frame, id: string) =>
  frame.locator(`[data-element-id="${id}"]`).first();

/**
 * Clicks an element where it is actually visible: the palette, the minimap toggle, or other
 * overlays can cover parts of a small diagram, as they would for a user. Verifies the selection.
 */
export async function clickElement(win: Page, frame: Frame, id: string): Promise<void> {
  const fraction = await element(frame, id).evaluate((gfx) => {
    const box = gfx.getBoundingClientRect();
    for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const hit = document.elementFromPoint(box.left + box.width * fx, box.top + box.height * fy);
        if (hit && gfx.contains(hit)) return { fx, fy };
      }
    }
    return undefined;
  });
  if (!fraction) throw new Error(`element ${id} is completely covered`);
  // Raw mouse coordinates: locator.click() would scroll the element into view, which scrolls
  // the overflow-hidden diagram container and shifts the whole canvas.
  const box = await element(frame, id).boundingBox();
  if (!box) throw new Error(`element ${id} has no box`);
  await win.mouse.click(box.x + box.width * fraction.fx, box.y + box.height * fraction.fy);
  await expect
    .poll(() => frame.locator(`.djs-element.selected[data-element-id="${id}"]`).count(), {
      timeout: 2000,
    })
    .toBe(1);
}

/** Bizmo's output channel, as written to the profile's log folder so far. */
export function bizmoLog(vscode: VsCode): string {
  const logs = join(vscode.userData, 'logs');
  if (!existsSync(logs)) return '';
  const files = readdirSync(logs, { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('Bizmo.log'),
  );
  return files.map((f) => readFileSync(join(logs, f), 'utf8')).join('\n');
}
