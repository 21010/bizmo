// M1 spikes S1 (CSP), S2 (re-import cost), S3 (serialisation churn) in headless Chromium.
// Usage: node spikes/run.mjs   → writes spikes/results/browser-spikes.json
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import * as esbuild from 'esbuild';
import { diffLines } from 'diff';
import { chromium } from 'playwright';
import { generate } from './generate.mjs';

const ROOT = 'spikes';
const OUT = join(ROOT, 'out');
const ORIGIN = 'http://bizmo-spike.local';
const NONCE = 'c3Bpa2Utbm9uY2UtMTIzNA==';

const CSP_VARIANTS = {
  strict: `style-src ${ORIGIN}`,
  target: `style-src ${ORIGIN} 'unsafe-inline'`,
};

// ---------- build ----------
await esbuild.build({
  entryPoints: { c8: `${ROOT}/harness/c8.js`, c7: `${ROOT}/harness/c7.js` },
  outdir: OUT,
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  minify: true,
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.eot': 'file', '.svg': 'file' },
  logLevel: 'warning',
});
writeFileSync(
  join(OUT, 'layout.css'),
  'html,body{margin:0;height:100%}body{display:flex}#canvas{flex:1;height:100%}#properties{width:300px;height:100%;overflow:auto}',
);
writeFileSync(join(OUT, 'violations.js'), readFileSync(`${ROOT}/harness/violations.js`));

const html = (platform, variant) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${NONCE}'; ${CSP_VARIANTS[variant]}; img-src ${ORIGIN} data:; font-src ${ORIGIN};">
<link rel="stylesheet" href="${ORIGIN}/layout.css"><link rel="stylesheet" href="${ORIGIN}/${platform}.css">
<script nonce="${NONCE}" src="${ORIGIN}/violations.js"></script>
</head><body><div id="canvas"></div><div id="properties"></div>
<script nonce="${NONCE}" src="${ORIGIN}/${platform}.js"></script></body></html>`;

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.svg': 'image/svg+xml' };

// ---------- corpus + generated diagrams ----------
const corpus = (platform) =>
  readdirSync(join(ROOT, 'corpus', platform)).map((name) => ({ name, xml: readFileSync(join(ROOT, 'corpus', platform, name), 'utf8') }));


// ---------- browser ----------
const browser = await chromium.launch();

async function openPage(platform, variant, query = '') {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path === 'index.html') return route.fulfill({ contentType: 'text/html', body: html(platform, variant) });
    const file = join(OUT, path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: MIME[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/index.html${query}`);
  await page.waitForFunction(() => window.spikeReady === true, null, { timeout: 15000 });
  return { page, consoleErrors };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const only = process.argv.slice(2);
const want = (id) => only.length === 0 || only.includes(id);
const previous = existsSync(join(ROOT, 'results', 'browser-spikes.json')) ? JSON.parse(readFileSync(join(ROOT, 'results', 'browser-spikes.json'), 'utf8')) : {};
const results = { ...previous, generatedAt: new Date().toISOString(), s1: want('s1') ? {} : previous.s1, s2: want('s2') ? {} : previous.s2, s3: want('s3') ? {} : previous.s3 };

// S1 — CSP compatibility: every corpus file + UI exercise, per platform and CSP variant.
for (const variant of want('s1') ? Object.keys(CSP_VARIANTS) : []) {
  for (const platform of ['c8', 'c7']) {
    const { page, consoleErrors } = await openPage(platform, variant);
    const files = corpus(platform);
    let importErrors = 0;
    let warnings = 0;
    const exerciseFailures = {};
    for (const { name, xml } of files) {
      const outcome = await page.evaluate(async (x) => {
        try {
          const r = await window.spike.importXML(x);
          const log = await window.spike.exercise();
          return { ok: true, warnings: r.warnings.length, log };
        } catch (e) {
          window.spike.recreate(); // failed imports can poison the instance (see spikes/README.md)
          return { ok: false, error: String(e.message || e) };
        }
      }, xml);
      if (!outcome.ok) {
        importErrors += 1;
        continue;
      }
      warnings += outcome.warnings;
      for (const s of outcome.log.filter((s) => !s.ok)) {
        exerciseFailures[s.name] ??= { count: 0, sample: s.error, file: name };
        exerciseFailures[s.name].count += 1;
      }
    }
    const violations = await page.evaluate(() => window.__violations);
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => `${f.family}:${f.status}`); });
    const byDirective = {};
    for (const v of violations) {
      const key = `${v.directive} ${v.blockedURI || ''}`.trim();
      byDirective[key] ??= { count: 0, sample: v.sample, source: v.source };
      byDirective[key].count += 1;
    }
    results.s1[`${platform}/${variant}`] = {
      files: files.length,
      importErrors,
      importWarnings: warnings,
      violations: violations.length,
      byDirective,
      exerciseFailures,
      fonts,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 15),
    };
    console.log(`S1 ${platform}/${variant}: ${files.length} files, ${importErrors} import errors, ${violations.length} CSP violations`);
    await page.close();
  }
}

// S2 — import / re-import cost on generated diagrams (C8, target CSP).
if (want('s2')) {
  const { page } = await openPage('c8', 'target');
  for (const n of [50, 500, 2000]) {
    const xml = generate(n);
    const r = await page.evaluate(async (x) => {
      const imports = [];
      const reimports = [];
      const saves = [];
      let restored = true;
      for (let i = 0; i < 5; i++) {
        imports.push((await window.spike.importXML(x)).ms);
      }
      const registry = window.spike.get('elementRegistry');
      window.spike.get('selection').select(registry.get('task_1'));
      window.spike.get('canvas').zoom(0.8, { x: 400, y: 300 });
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        await window.spike.saveXML();
        saves.push(performance.now() - t);
        const re = await window.spike.reimportPreservingView(x);
        reimports.push(re.ms);
        restored = restored && re.viewboxRestored && re.selectionRestored;
      }
      return { elements: window.spike.elementCount(), imports, reimports, saves, restored };
    }, xml);
    results.s2[n] = {
      elements: r.elements,
      xmlKb: Math.round(xml.length / 1024),
      importMedianMs: Math.round(median(r.imports)),
      reimportMedianMs: Math.round(median(r.reimports)),
      saveXmlMedianMs: Math.round(median(r.saves)),
      viewAndSelectionRestored: r.restored,
    };
    console.log(`S2 ${n} tasks:`, results.s2[n]);
  }
  await page.close();
}

// Classifies how out1 differs from the original (content already known to differ beyond whitespace).
function classify(original, out) {
  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const a = lines(original);
  const b = lines(out);
  const sorted = (x) => [...x].sort().join('\n');
  if (sorted(a) === sorted(b)) return 'reorder-only';
  // Compare with the <definitions> header and trailing newline neutralised.
  const body = (x) => x.filter((l) => !/^<(\w+:)?definitions\b/.test(l) && !l.startsWith('<?xml'));
  const ba = body(a);
  const bb = body(b);
  if (ba.join('\n') === bb.join('\n')) return 'header-only';
  if (sorted(ba) === sorted(bb)) return 'header+reorder';
  // Attribute order within a line (same attributes, different order).
  const attrs = (l) => l.replace(/\s*\/?>$/, '').split(/\s+(?=[\w:-]+=")/).sort().join(' ');
  if (sorted(ba.map(attrs)) === sorted(bb.map(attrs))) return 'attribute-order/reorder';
  return 'other';
}

// S3 — serialisation churn: original → import → saveXML (out1) → import → saveXML (out2).
for (const [platform, mode] of want('s3') ? [['c8', 'default'], ['c7', 'default'], ['c8', 'noAlign'], ['c7', 'noAlign']] : []) {
  const { page } = await openPage(platform, 'target', mode === 'noAlign' ? '?noAlign' : '');
  const stats = { files: 0, identical: 0, whitespaceOnly: 0, contentChanged: 0, idempotent: 0, kinds: {}, changedLines: [], samples: [] };
  for (const { name, xml } of corpus(platform)) {
    const r = await page.evaluate(async (x) => {
      try {
        await window.spike.importXML(x);
        const out1 = await window.spike.saveXML();
        await window.spike.importXML(out1);
        const out2 = await window.spike.saveXML();
        return { out1, out2 };
      } catch (e) {
        window.spike.recreate();
        return { error: String(e.message || e) };
      }
    }, xml);
    if (r.error) continue;
    stats.files += 1;
    const original = xml.replace(/\r\n/g, '\n');
    const out1 = r.out1;
    if (r.out2 === out1) stats.idempotent += 1;
    if (original.trimEnd() === out1.trimEnd()) {
      stats.identical += 1;
      continue;
    }
    const norm = (s) => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    if (norm(original) === norm(out1)) {
      stats.whitespaceOnly += 1;
      continue;
    }
    stats.contentChanged += 1;
    const parts = diffLines(original, out1);
    const changed = parts.filter((p) => p.added || p.removed).reduce((n, p) => n + p.count, 0);
    stats.changedLines.push(changed);
    const kind = classify(original, out1);
    stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
    if (kind === 'other' && stats.samples.length < 12) {
      stats.samples.push({
        name,
        changedLines: changed,
        crlf: xml.includes('\r\n'),
        hunks: parts
          .filter((p) => p.added || p.removed)
          .slice(0, 4)
          .map((p) => `${p.added ? '+' : '-'} ${p.value.trim().slice(0, 220)}`),
      });
    }
  }
  stats.changedLinesMedian = stats.changedLines.length ? median(stats.changedLines) : 0;
  results.s3[`${platform}/${mode}`] = stats;
  console.log(`S3 ${platform}/${mode}: kinds ${JSON.stringify(stats.kinds)}; ${stats.files} files, identical ${stats.identical}, whitespace-only ${stats.whitespaceOnly}, content ${stats.contentChanged}, idempotent ${stats.idempotent}`);
  await page.close();
}

await browser.close();
mkdirSync(join(ROOT, 'results'), { recursive: true });
writeFileSync(join(ROOT, 'results', 'browser-spikes.json'), JSON.stringify(results, null, 2));
console.log('written spikes/results/browser-spikes.json');
