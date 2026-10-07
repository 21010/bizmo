// Types single characters into a DMN table cell with pauses and records, per character, whether it
// arrived and which events the webview saw (keydown, beforeinput, focus changes).
import { appendFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, it } from 'vitest';
import { dirtyTabs, launchVsCode, openFromExplorer, type VsCode } from '../../test/e2e/vscode';

let vscode: VsCode;
const out = (line: string) => appendFileSync(process.env.OUT ?? 'spikes/keys/out.txt', `${line}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'bizmo-keys-'));
  copyFileSync('test/fixtures/dmn/c8-dish.dmn', join(workspace, 'dish.dmn'));
  vscode = await launchVsCode({ workspace });
});
afterAll(async () => {
  await vscode.app.close();
});

it('probe', async () => {
  const win = vscode.win;
  const frame = await openFromExplorer(win, 'dish.dmn', '.dmn-drd-container .djs-container');
  await frame.click('.drill-down-overlay button[title="Open decision table"]');
  await frame.locator('td[data-element-id="OutputEntry_Winter"]').click();
  await win.keyboard.press('End');
  await frame.evaluate(() => {
    const w = window as unknown as { __ev: string[] };
    w.__ev = [];
    const t0 = performance.now();
    for (const type of ['keydown', 'beforeinput', 'focusin', 'focusout', 'blur', 'focus']) {
      window.addEventListener(
        type,
        (e) => {
          const target = e.target as HTMLElement | Window;
          const name = target instanceof HTMLElement ? target.className || target.tagName : 'window';
          w.__ev.push(
            `${Math.round(performance.now() - t0)} ${type}${'key' in e ? `:${(e as KeyboardEvent).key}` : ''} ${name}${e.defaultPrevented ? ' PREVENTED' : ''}`,
          );
        },
        true,
      );
    }
    document.addEventListener('visibilitychange', () => w.__ev.push(`visibility ${document.visibilityState}`));
  });
  const letters = 'abcdefghij';
  for (const [i, pause] of [100, 400, 700, 1000, 400, 400, 700, 150, 1000, 400].entries()) {
    const letter = letters[i];
    const before = await frame.locator('td[data-element-id="OutputEntry_Winter"] .cm-content').textContent();
    await win.keyboard.type(letter);
    await sleep(200);
    const after = await frame.locator('td[data-element-id="OutputEntry_Winter"] .cm-content').textContent();
    out(`${letter} after pause ${pause}: ${after?.endsWith(letter) ? 'ok' : 'DROPPED'} (${before} -> ${after}) dirty=${await dirtyTabs(win)}`);
    await sleep(pause);
  }
  const events = await frame.evaluate(() => (window as unknown as { __ev: string[] }).__ev);
  for (const e of events) out(`  ${e}`);
});
