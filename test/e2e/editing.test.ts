// End-to-end: real VS Code (Electron) driven by Playwright with trusted mouse and keyboard input.
// Covers what neither browser nor extension-host tests can: VS Code's keyboard routing from the
// webview, document undo/redo, dirty state, and save.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron, type ElectronApplication, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = resolve('.');
let app: ElectronApplication;
let win: Page;
let workspace: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dirtyTabs = () => win.locator('.tabs-container .tab.dirty').count();

/** VS Code's default shortcuts per platform. */
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const keys = {
  close: `${mod}+W`,
  undo: `${mod}+Z`,
  redo: process.platform === 'win32' ? 'Control+Y' : `${mod}+Shift+Z`,
  save: `${mod}+S`,
  copy: `${mod}+C`,
  paste: `${mod}+V`,
};

beforeAll(async () => {
  const executablePath = await downloadAndUnzipVSCode(
    process.env['VSCODE_TEST_VERSION'] ?? 'stable',
  );
  workspace = mkdtempSync(join(tmpdir(), 'bizmo-e2e-ws-'));
  copyFileSync('test/fixtures/bpmn/c8-order.bpmn', join(workspace, 'order.bpmn'));
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
    }),
  );
  app = await electron.launch({
    executablePath,
    args: [
      `--extensionDevelopmentPath=${REPO}`,
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${userData}`,
    ],
  });
  win = await app.firstWindow();
  // Same size as CI runners' default screen, so local runs see the layout CI sees.
  // (Typed locally: the part of Electron's main-process API used here.)
  interface ElectronMain {
    BrowserWindow: { getAllWindows(): { setSize(width: number, height: number): void }[] };
  }
  await app.evaluate(({ BrowserWindow }: ElectronMain) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1024, 768);
  });
});

afterAll(async () => {
  await app.close();
});

/** Opens a file from the Explorer and returns the webview frame showing the diagram. */
async function openFromExplorer(name: string): Promise<Frame> {
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

const element = (frame: Frame, id: string) => frame.locator(`[data-element-id="${id}"]`).first();

/**
 * Clicks an element where it is actually visible: the palette, the minimap toggle, or other
 * overlays can cover parts of a small diagram, as they would for a user.
 */
async function clickElement(frame: Frame, id: string): Promise<void> {
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

const onDisk = () => readFileSync(join(workspace, 'order.bpmn'), 'utf8');

describe('BPMN editing in VS Code', () => {
  let frame: Frame;

  it('opens from the Explorer in the diagram editor', async () => {
    frame = await openFromExplorer('order.bpmn');
    await expect.poll(() => element(frame, 'Task_Ship').count()).toBe(1);
    expect(await dirtyTabs()).toBe(0);
  });

  it('Delete changes the document (dirty)', async () => {
    await clickElement(frame, 'Task_Ship');
    await win.keyboard.press('Delete');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
    expect(await element(frame, 'Task_Ship').count()).toBe(0);
  });

  it('Ctrl+Z undoes exactly once, through VS Code (document clean again)', async () => {
    await clickElement(frame, 'Task_Check');
    await win.keyboard.press(keys.undo);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    await expect.poll(() => element(frame, 'Task_Ship').count(), { timeout: 5000 }).toBe(1);
  });

  it('Ctrl+Y redoes', async () => {
    await win.keyboard.press(keys.redo);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
    await expect.poll(() => element(frame, 'Task_Ship').count(), { timeout: 5000 }).toBe(0);
  });

  it('Ctrl+S right after an edit saves that edit too (pre-save flush)', async () => {
    await clickElement(frame, 'EndEvent_Rejected');
    await win.keyboard.press('Delete');
    await win.keyboard.press(keys.save); // well within the 300 ms debounce
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    const saved = onDisk();
    expect(saved).not.toContain('id="Task_Ship"');
    expect(saved).not.toContain('id="EndEvent_Rejected"');
    expect(saved).toContain('id="Task_Check"');
  });

  it('Ctrl+C / Ctrl+V duplicates an element (paste follows the mouse; click places it)', async () => {
    const shapes = () => frame.locator('.djs-shape').count();
    const before = await shapes();
    await clickElement(frame, 'Task_Check');
    await win.keyboard.press(keys.copy);
    await win.keyboard.press(keys.paste);
    const box = await frame.locator('.djs-container').boundingBox();
    if (!box) throw new Error('no canvas');
    const target = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.75 };
    await win.mouse.move(target.x - 20, target.y - 20);
    await win.mouse.move(target.x, target.y, { steps: 5 });
    await win.mouse.click(target.x, target.y);
    await expect.poll(shapes, { timeout: 5000 }).toBeGreaterThan(before);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);
  });

  it('a property typed in the panel goes into the file, and undo in the field reverts it once', async () => {
    await win.keyboard.press(keys.save);
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);

    await clickElement(frame, 'Task_Check');
    const type = frame.locator('#bio-properties-panel-taskDefinitionType');
    if (!(await type.isVisible())) {
      await frame
        .locator('[data-group-id="group-taskDefinition"] .bio-properties-panel-group-header')
        .click();
    }
    await type.click();
    await type.press(`${mod}+A`);
    await win.keyboard.type('check-inventory');
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(1);

    await win.keyboard.press(keys.undo); // focus is still in the panel field
    await expect.poll(dirtyTabs, { timeout: 5000 }).toBe(0);
    await expect
      .poll(() => frame.locator('#bio-properties-panel-taskDefinitionType').inputValue(), {
        timeout: 5000,
      })
      .toBe('check-stock');
    expect(onDisk()).toContain('type="check-stock"');
  });
});
