// S4: drives VS Code (Electron) with *trusted* keystrokes via Playwright and records what happens.
// Prerequisite: node spikes/vscode-ext/run-tests.mjs (builds media/ and the .ws fixtures).
// Usage: node spikes/vscode-ext/keyboard.mjs
import { copyFileSync, mkdtempSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const EXT = resolve('spikes/vscode-ext');
const WS = join(EXT, '.ws');
const install = readdirSync('.vscode-test').find((d) => d.startsWith('vscode-win32-x64-archive-1.140'));
const CODE = resolve('.vscode-test', install, 'Code.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(mode) {
  const target = join(WS, `kbd-${mode}.bpmn`);
  copyFileSync(join(WS, 'c8.bpmn'), target);
  const app = await electron.launch({
    executablePath: CODE,
    args: [
      `--extensionDevelopmentPath=${EXT}`,
      WS,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bizmo-kbd-'))}`,
    ],
    env: { ...process.env, BIZMO_SPIKE_OPEN: target, BIZMO_SPIKE_NO_SWALLOW: mode === 'noSwallow' ? '1' : '' },
  });
  const win = await app.firstWindow();
  let frame;
  for (let i = 0; i < 300 && !frame; i++) {
    for (const f of win.frames()) {
      try {
        if (await f.evaluate(() => typeof window.__spikeStats === 'object' && window.__spikeStats.imports > 0)) frame = f;
      } catch {
        // frame not ready / cross-origin during navigation
      }
    }
    if (!frame) await sleep(100);
  }
  if (!frame) throw new Error('webview frame not found');
  return { app, win, frame };
}

const stats = (frame) =>
  frame.evaluate(() => ({
    ...window.__spikeStats,
    elements: window.__spike.modeler.get('elementRegistry').getAll().length,
    selected: window.__spike.modeler.get('selection').get().length,
    searchOpen: !!document.querySelector('.djs-search-container.open, .djs-search-open, .djs-search-container:not(.djs-hidden)'),
  }));
const dirty = (win) => win.locator('.tabs-container .tab.dirty').count();

async function appendTask(frame) {
  await frame.evaluate(() => {
    const m = window.__spike.modeler;
    const start = m.get('elementRegistry').filter((e) => e.type === 'bpmn:StartEvent')[0];
    m.get('autoPlace').append(start, m.get('elementFactory').createShape({ type: 'bpmn:Task' }));
  });
  await sleep(900); // debounce + applyEdit
}

async function clickElement(frame, type) {
  const handle = await frame.evaluateHandle((t) => {
    const m = window.__spike.modeler;
    const el = m.get('elementRegistry').filter((e) => e.type === t)[0];
    return m.get('elementRegistry').getGraphics(el);
  }, type);
  await handle.asElement().click({ force: true });
}

const results = {};

// Control experiment: Ctrl+Z with and without swallowing bpmn-js' own undo binding.
for (const mode of ['noSwallow', 'swallow']) {
  const { app, win, frame } = await launch(mode);
  const s0 = await stats(frame);
  await appendTask(frame);
  const s1 = await stats(frame);
  await clickElement(frame, 'bpmn:StartEvent'); // trusted click: focus the canvas
  await win.keyboard.press('Control+Z');
  await sleep(1500);
  const s2 = await stats(frame);
  results[`ctrlZ/${mode}`] = {
    elementsBefore: s0.elements,
    elementsAfterEdit: s1.elements,
    elementsAfterCtrlZ: s2.elements,
    bpmnJsUndos: s2.bpmnUndos - s1.bpmnUndos,
    reimports: s2.imports - s1.imports,
    extraEditsPosted: s2.editsPosted - s1.editsPosted,
    swallowed: s2.swallowed - s1.swallowed,
    tabDirtyAfter: await dirty(win),
  };

  if (mode === 'swallow') {
    // Keybinding table: what each key does with the recommended configuration.
    const keys = {};
    const before = await stats(frame);
    await win.keyboard.press('Control+Y');
    await sleep(1500);
    let after = await stats(frame);
    keys['Ctrl+Y (redo)'] = { elements: `${before.elements}→${after.elements}`, reimports: after.imports - before.imports, bpmnJsUndos: after.bpmnUndos - before.bpmnUndos };

    await clickElement(frame, 'bpmn:Task');
    let b = await stats(frame);
    await win.keyboard.press('Delete');
    await sleep(1200);
    after = await stats(frame);
    keys['Delete (remove selected)'] = { elements: `${b.elements}→${after.elements}`, editsPosted: after.editsPosted - b.editsPosted };

    b = await stats(frame);
    await win.keyboard.press('Control+A');
    await sleep(300);
    after = await stats(frame);
    keys['Ctrl+A (select all)'] = { selected: `${b.selected}→${after.selected}` };

    await clickElement(frame, 'bpmn:StartEvent');
    b = await stats(frame);
    await win.keyboard.press('Control+C');
    await sleep(200);
    await win.keyboard.press('Control+V');
    await sleep(1200);
    after = await stats(frame);
    keys['Ctrl+C, Ctrl+V (copy/paste)'] = { elements: `${b.elements}→${after.elements}`, editsPosted: after.editsPosted - b.editsPosted, errors: after.errors };
    await win.keyboard.press('Escape');

    b = await stats(frame);
    await win.keyboard.press('Control+F');
    await sleep(500);
    after = await stats(frame);
    keys['Ctrl+F (find)'] = { bpmnSearchOpen: after.searchOpen, vscodeFindWidget: await win.locator('.monaco-workbench .webview .find-widget, .simple-find-part-wrapper.visible').count() };
    await win.keyboard.press('Escape');

    const dirtyBefore = await dirty(win);
    await win.keyboard.press('Control+S');
    await sleep(1500);
    keys['Ctrl+S (save)'] = { tabDirty: `${dirtyBefore}→${await dirty(win)}` };

    b = await stats(frame);
    await win.keyboard.press('Control+P');
    await sleep(800);
    keys['Ctrl+P (quick open)'] = { quickOpenVisible: await win.locator('.quick-input-widget:visible').count() };
    await win.keyboard.press('Escape');
    results.keys = keys;
  }
  await app.close();
}

mkdirSync('spikes/results', { recursive: true });
writeFileSync('spikes/results/keyboard.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
