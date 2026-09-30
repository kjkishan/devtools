'use strict';

/* ================================================================
   Markdown to PDF tab: live preview, document settings (theme,
   cover, header/footer), Mermaid diagrams, and export to PDF
   (pdfmake, no print dialog), HTML and .md. Everything runs locally.
   ================================================================ */

(() => {
  const q = (id) => document.getElementById(id);
  const ui = {
    input: q('mdInput'), inStatus: q('mdInStatus'), inputPanel: q('mdInputPanel'), fileInput: q('mdFileInput'),
    frame: q('mdFrame'), panel: q('mdPreviewPanel'), status: q('mdStatus'), fileName: q('mdFileName'),
    pdfBtn: q('mdPdfBtn'), htmlBtn: q('mdHtmlBtn'), fsBtn: q('mdFsBtn'),
    page: q('mdPage'), orient: q('mdOrient'), margin: q('mdMargin'), size: q('mdSize'), pageNums: q('mdPageNums'),
    theme: q('mdTheme'), accent: q('mdAccent'), spacing: q('mdSpacing'), moreBtn: q('mdMoreBtn'), more: q('mdMore'),
    cover: q('mdCover'), coverTitle: q('mdCoverTitle'), coverSubtitle: q('mdCoverSubtitle'), coverAuthor: q('mdCoverAuthor'),
    coverDate: q('mdCoverDate'), headerText: q('mdHeaderText'), footerText: q('mdFooterText'),
  };

  const PAGE_MM = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
  const SANS = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const MONO = 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, "SFMono-Regular", Menlo, monospace';
  const SPACING = { compact: 1.4, normal: 1.6, relaxed: 1.85 };
  const HL = {
    kw: '#cf222e', str: '#0a3069', com: '#6e7781', num: '#0550ae', fn: '#8250df',
    type: '#953800', lit: '#0550ae', tag: '#116329', attr: '#0550ae', key: '#0550ae',
  };

  const SAMPLE = `# Project Status Report

**Prepared by:** Engineering team · *September 2026*

[TOC]

> [!NOTE]
> This sample shows what the converter supports. Replace it with your own Markdown.

## Summary

The release is **on track**. Key points:

- Costing engine moved to the new pipeline
- ~~Legacy export~~ replaced by CSV and XLSX export
- Details are on the [project page](https://example.com/project)
  - Nested items work too
  - So does \`inline code\`

## Checklist

- [x] API changes merged
- [x] UI changes reviewed
- [ ] QA sign-off

## Numbers

| Module    | Status  | Coverage |
|:----------|:-------:|---------:|
| Costing   | Done    |      86% |
| Data      | Review  |      74% |
| Analytics | Planned |        — |

## Flow

\`\`\`mermaid
flowchart LR
  A[Upload BOM] --> B{Valid?}
  B -- yes --> C[Resolve prices]
  B -- no --> D[Show errors]
  C --> E[Report]
\`\`\`

## Code

\`\`\`ts
export function total(items: { price: number; qty: number }[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}
\`\`\`

\`\`\`sql
SELECT TOP 10 PartId, Price -- latest first
FROM dbo.tblPartPrice
WHERE IsDeleted = 0
ORDER BY CreateDate DESC;
\`\`\`

## How to export

1. Paste Markdown on the left
2. Pick a theme, page size and margins (and a cover page under **Cover & header**)
3. Click **Download PDF**; the file is saved straight away

> Tip: put \`\\pagebreak\` on its own line to start a new page, and \`[TOC]\` for a table of contents.
`;

  /* ---------- settings ---------- */

  const readJson = (raw) => { try { return JSON.parse(raw) || {}; } catch { return {}; } };
  const DEFAULTS = {
    page: 'A4', orient: 'portrait', margin: '18mm', size: '11', pageNums: true,
    theme: 'github', accent: '#2563eb', spacing: 'normal',
    cover: false, coverTitle: '', coverSubtitle: '', coverAuthor: '', coverDate: '', headerText: '', footerText: '',
  };
  const settings = Object.assign({}, DEFAULTS, readJson(store.get('md.settings')));
  const selects = { page: ui.page, orient: ui.orient, margin: ui.margin, size: ui.size, theme: ui.theme, spacing: ui.spacing };
  const texts = {
    coverTitle: ui.coverTitle, coverSubtitle: ui.coverSubtitle, coverAuthor: ui.coverAuthor,
    coverDate: ui.coverDate, headerText: ui.headerText, footerText: ui.footerText,
  };
  for (const [key, el] of Object.entries(selects)) {
    if ([...el.options].some((o) => o.value === settings[key])) el.value = settings[key];
    else settings[key] = el.value;
  }
  for (const [key, el] of Object.entries(texts)) el.value = settings[key] || '';
  if (!/^#[\da-f]{6}$/i.test(settings.accent)) settings.accent = DEFAULTS.accent;
  ui.accent.value = settings.accent;
  ui.pageNums.checked = !!settings.pageNums;
  ui.cover.checked = !!settings.cover;

  function readSettings() {
    for (const [key, el] of Object.entries(selects)) settings[key] = el.value;
    for (const [key, el] of Object.entries(texts)) settings[key] = el.value;
    settings.accent = ui.accent.value;
    settings.pageNums = ui.pageNums.checked;
    settings.cover = ui.cover.checked;
    store.set('md.settings', JSON.stringify(settings));
  }

  function pageDims() {
    const [w, h] = PAGE_MM[settings.page] || PAGE_MM.A4;
    return settings.orient === 'landscape' ? [h, w] : [w, h];
  }

  // mix a hex colour with white
  function tint(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * (1 - amount)).toString(16).padStart(2, '0');
    return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
  }

  function theme() {
    const a = settings.accent;
    if (settings.theme === 'accent') {
      return { heading: a, rule: a, ruleWidth: 1.2, link: a, thBg: a, thColor: '#ffffff', grid: '#d0d7de', vLines: true, quote: a, zebra: tint(a, 0.06), accent: a };
    }
    if (settings.theme === 'minimal') {
      return { heading: '#111827', rule: null, ruleWidth: 0, link: a, thBg: null, thColor: '#111827', grid: '#e5e7eb', vLines: false, quote: '#d1d5db', zebra: null, accent: a };
    }
    return { heading: '#1f2328', rule: '#d8dee4', ruleWidth: 0.6, link: '#0969da', thBg: '#f6f8fa', thColor: '#1f2328', grid: '#d0d7de', vLines: true, quote: '#d0d7de', zebra: '#f9fafb', accent: a };
  }

  const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  function coverInfo(docTitle) {
    return {
      title: settings.coverTitle.trim() || docTitle || 'Untitled document',
      subtitle: settings.coverSubtitle.trim(),
      author: settings.coverAuthor.trim(),
      date: settings.coverDate.trim() || today(),
    };
  }

  const fillTokens = (text, page, pages, title) => text
    .replace(/\{title\}/gi, title || '')
    .replace(/\{date\}/gi, today())
    .replace(/\{page\}/gi, String(page))
    .replace(/\{pages\}/gi, String(pages));

  /* ---------- document CSS (preview and HTML export) ---------- */

  function contentCss(t) {
    const cellBorder = t.vLines ? `border: 1px solid ${t.grid};` : `border: 0; border-bottom: 1px solid ${t.grid};`;
    const hl = Object.entries(HL).map(([k, c]) => `.hl-${k} { color: ${c}; }`).join('\n');
    return `
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: #1f2328; font-family: Roboto, ${SANS}; font-size: ${settings.size}pt; line-height: ${SPACING[settings.spacing]}; overflow-wrap: break-word; }
.doc > :first-child { margin-top: 0 !important; }
.doc > :last-child { margin-bottom: 0 !important; }
h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 .6em; font-weight: 600; line-height: 1.25; color: ${t.heading}; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 2em; ${t.rule ? `padding-bottom: .3em; border-bottom: ${t.ruleWidth + 0.4}px solid ${t.rule};` : ''} }
h2 { font-size: 1.5em; ${t.rule ? `padding-bottom: .3em; border-bottom: ${t.ruleWidth + 0.4}px solid ${t.rule};` : ''} }
h3 { font-size: 1.25em; } h4 { font-size: 1em; } h5 { font-size: .875em; } h6 { font-size: .85em; color: #59636e; }
p, ul, ol, blockquote, pre, table, dl, details, .alert { margin: 0 0 1em; }
ul, ol { padding-left: 2em; }
li + li { margin-top: .25em; }
li > ul, li > ol { margin: .25em 0 0; }
li > p { margin: .5em 0; }
li.task { list-style: none; }
li.task > input { margin: 0 .45em 0 -1.4em; vertical-align: -.1em; }
a { color: ${t.link}; text-decoration: none; }
a:hover { text-decoration: underline; }
strong { font-weight: 600; }
mark { background: #fff3b0; padding: 0 .15em; }
code, kbd, pre { font-family: ${MONO}; }
code { font-size: .86em; padding: .15em .4em; border-radius: 5px; background: #eff1f4; }
pre { font-size: .85em; line-height: 1.5; padding: 12px 14px; border: 1px solid #e1e5ea; border-radius: 6px; background: #f6f8fa; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
pre code { padding: 0; border-radius: 0; background: none; font-size: inherit; }
kbd { font-size: .8em; padding: .1em .4em; border: 1px solid #d0d7de; border-bottom-width: 2px; border-radius: 5px; background: #f6f8fa; }
blockquote { padding: 0 1em; color: #59636e; border-left: .25em solid ${t.quote}; }
table { border-collapse: collapse; max-width: 100%; font-size: .95em; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { padding: 6px 12px; ${cellBorder} overflow-wrap: anywhere; }
th { font-weight: 600; background: ${t.thBg || 'transparent'}; color: ${t.thColor}; ${t.vLines ? '' : `border-bottom: 2px solid ${t.heading};`} }
tbody tr:nth-child(even) { background: ${t.zebra || 'transparent'}; }
img { max-width: 100%; height: auto; break-inside: avoid; }
hr { height: 0; margin: 1.6em 0; border: 0; border-top: 1px solid ${t.rule || '#e5e7eb'}; }
.alert { padding: .6em 1em; border-left: .25em solid; border-radius: 0 6px 6px 0; break-inside: avoid; }
.alert > :last-child { margin-bottom: 0; }
.alert-title { margin: 0 0 .3em; font-weight: 600; }
.alert-note { border-color: #0969da; background: #f0f6ff; } .alert-note .alert-title { color: #0969da; }
.alert-tip { border-color: #1a7f37; background: #effaf2; } .alert-tip .alert-title { color: #1a7f37; }
.alert-important { border-color: #8250df; background: #f6f1ff; } .alert-important .alert-title { color: #8250df; }
.alert-warning { border-color: #9a6700; background: #fff8e5; } .alert-warning .alert-title { color: #9a6700; }
.alert-caution { border-color: #cf222e; background: #fff1f0; } .alert-caution .alert-title { color: #cf222e; }
.toc { margin: 0 0 1.4em; padding: .8em 1.1em; border: 1px solid #e1e5ea; border-radius: 8px; background: #fafbfc; break-inside: avoid; }
.toc-title { margin: 0 0 .4em; font-weight: 600; color: ${t.heading}; }
.toc ul { margin: 0; padding-left: 1.2em; list-style: none; }
.toc > ul { padding-left: 0; }
.toc li { margin: .15em 0; }
.toc a { color: inherit; }
.mermaid-block { margin: 0 0 1em; text-align: center; break-inside: avoid; }
.mermaid-block svg { max-width: 100%; height: auto; }
.mermaid-block pre { text-align: left; }
.mermaid-error { margin-bottom: .4em; color: #cf222e; font-size: .9em; text-align: left; }
.page-break { height: 0; break-after: page; page-break-after: always; }
.placeholder { color: #8c959f; font-style: italic; }
.cover { display: flex; flex-direction: column; justify-content: flex-start; padding-top: 28%; }
.cover-title { margin: 0 0 .35em; padding: 0; border: 0; font-size: 2.6em; font-weight: 700; line-height: 1.15; color: ${t.accent}; }
.cover-sub { margin: 0 0 1.2em; font-size: 1.35em; color: #57606a; }
.cover-rule { width: 80px; height: 3px; margin: 0 0 1.4em; background: ${t.accent}; }
.cover-author { margin: 0; font-size: 1.1em; font-weight: 600; }
.cover-date { margin: .2em 0 0; color: #57606a; }
${hl}
.hl-com { font-style: italic; }`;
  }

  function previewCss(t) {
    const [w, h] = pageDims();
    const m = settings.margin;
    const backdrop = getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#e8ebf0';
    return `${contentCss(t)}
[hidden] { display: none !important; }
html, body { background: ${backdrop}; }
body { padding: 20px 0 40px; }
.sheet { position: relative; display: flex; flex-direction: column; width: ${w}mm; min-height: ${h}mm; margin: 0 auto; padding: ${m}; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08); zoom: var(--fit, 1); }
.sheet + .sheet { margin-top: 24px; }
.doc { flex: 1; }
.run { position: absolute; left: ${m}; right: ${m}; font: 8pt/1.4 ${SANS}; color: #6e7781; }
.run:empty { display: none; }
.run-head { top: calc(${m} / 2 - 5pt); text-align: right; }
.run-foot { bottom: calc(${m} / 2 - 5pt); display: flex; justify-content: space-between; gap: 12px; }
.run-foot.center { justify-content: center; }
.page-break { margin: 2em calc(-1 * ${m}); border-top: 2px dashed #c9ced6; }`;
  }

  /* ---------- preview frame ---------- */

  // written once, then only the parts are updated so scroll position survives edits
  const fdoc = ui.frame.contentDocument;
  fdoc.open();
  fdoc.write(`<!doctype html><html><head><meta charset="utf-8"><title>document</title><style id="docStyle"></style></head><body>
<section class="sheet cover-sheet" id="coverSheet" hidden><div class="cover" id="cover"></div></section>
<section class="sheet" id="sheet"><div class="run run-head" id="runHead"></div><article class="doc" id="doc"></article><div class="run run-foot" id="runFoot"></div></section>
</body></html>`);
  fdoc.close();
  const docEl = fdoc.getElementById('doc');
  const coverSheet = fdoc.getElementById('coverSheet');
  const coverEl = fdoc.getElementById('cover');
  const runHead = fdoc.getElementById('runHead');
  const runFoot = fdoc.getElementById('runFoot');

  fdoc.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      const target = fdoc.getElementById(decodeURIComponent(href.slice(1)));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (href !== '#') {
      window.open(href, '_blank', 'noopener');
    }
  });

  function applyDocStyle() {
    fdoc.getElementById('docStyle').textContent = previewCss(theme());
    updateFit();
  }

  function updateFit() {
    const [w] = pageDims();
    const pagePx = (w * 96) / 25.4;
    const avail = ui.frame.clientWidth - 32;
    const fit = avail > 0 ? Math.min(1, avail / pagePx) : 1;
    fdoc.documentElement.style.setProperty('--fit', fit.toFixed(3));
  }

  function toFileName(name) {
    return (name || '').replace(/\.(pdf|html?|md)$/i, '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'document';
  }

  function coverHtml(docTitle) {
    const c = coverInfo(docTitle);
    return `<h1 class="cover-title">${esc(c.title)}</h1>` +
      (c.subtitle ? `<p class="cover-sub">${esc(c.subtitle)}</p>` : '') +
      '<div class="cover-rule"></div>' +
      (c.author ? `<p class="cover-author">${esc(c.author)}</p>` : '') +
      `<p class="cover-date">${esc(c.date)}</p>`;
  }

  // cover sheet and running header/footer shown on the preview sheet
  function renderChrome(docTitle) {
    coverSheet.hidden = !settings.cover;
    coverEl.innerHTML = settings.cover ? coverHtml(docTitle) : '';
    runHead.textContent = settings.headerText.trim() ? fillTokens(settings.headerText, 1, 'N', docTitle) : '';
    const foot = settings.footerText.trim() ? fillTokens(settings.footerText, 1, 'N', docTitle) : '';
    runFoot.textContent = '';
    runFoot.className = `run run-foot${foot ? '' : ' center'}`;
    if (foot) runFoot.append(Object.assign(document.createElement('span'), { textContent: foot }));
    if (settings.pageNums) runFoot.append(Object.assign(document.createElement('span'), { textContent: '1 / N' }));
  }

  let lastRender = { html: '', title: '', words: 0, tocIds: [] };
  let nameEdited = false;
  let renderTimer = null;
  let draftTimer = null;
  let pendingMermaid = Promise.resolve();

  function renderNow() {
    clearTimeout(renderTimer);
    const src = ui.input.value;
    const has = !!src.trim();
    lastRender = Markdown.render(src);
    docEl.innerHTML = has
      ? lastRender.html
      : '<p class="placeholder">The preview appears here. Paste Markdown on the left, open a .md file, or load the sample.</p>';
    if (!nameEdited) ui.fileName.value = toFileName(lastRender.title);
    renderChrome(lastRender.title);
    ui.pdfBtn.disabled = !has;
    ui.htmlBtn.disabled = !has;
    const [w, h] = pageDims();
    const pageInfo = `${settings.page} ${settings.orient} (${Math.round(w)}×${Math.round(h)} mm)`;
    ui.status.textContent = has
      ? `${lastRender.words.toLocaleString()} words · ~${Math.max(1, Math.round(lastRender.words / 220))} min read · ${pageInfo}`
      : pageInfo;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (src.length < 1_000_000) store.set('md.draft', src); }, 500);
    pendingMermaid = renderMermaid();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderNow, 150);
  }

  function updateCaret() {
    const ta = ui.input;
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    ui.inStatus.textContent = `Ln ${line}, Col ${col}${ta.value.length ? ` · ${ta.value.length.toLocaleString()} characters` : ''}`;
  }

  let settingsTimer = null;
  function onSettingsChange(immediate = true) {
    readSettings();
    clearTimeout(settingsTimer);
    const apply = () => { applyDocStyle(); renderNow(); };
    if (immediate) apply(); else settingsTimer = setTimeout(apply, 250);
  }

  /* ---------- Mermaid (vendor/mermaid.min.js, rendered locally) ---------- */

  const mermaidCache = new Map();
  let mermaidReady = false;
  let mermaidGen = 0;
  let mermaidSeq = 0;

  function initMermaid() {
    if (typeof mermaid === 'undefined') return false;
    if (!mermaidReady) {
      // plain SVG text labels (no HTML inside the SVG) so diagrams can be turned into PNG for the PDF
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        fontFamily: 'Segoe UI, Roboto, Arial, sans-serif',
      });
      mermaidReady = true;
    }
    return true;
  }

  async function renderDiagram(src) {
    const id = `mmd${Date.now().toString(36)}${mermaidSeq++}`;
    try {
      const { svg } = await mermaid.render(id, src);
      return { svg };
    } catch (e) {
      return { error: String(e?.message || e).split('\n').slice(0, 3).join(' ') };
    } finally {
      // mermaid can leave its scratch element behind after a failure
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  }

  async function renderMermaid() {
    const blocks = [...docEl.querySelectorAll('.mermaid-block')];
    if (!blocks.length) return;
    if (!initMermaid()) {
      blocks.forEach((b) => b.insertAdjacentHTML('afterbegin', '<div class="mermaid-error">Diagram library missing: keep the vendor folder next to index.html.</div>'));
      return;
    }
    const gen = ++mermaidGen;
    for (const b of blocks) {
      const src = b.dataset.src || '';
      let out = mermaidCache.get(src);
      if (!out) {
        out = await renderDiagram(src);
        mermaidCache.set(src, out);
        if (mermaidCache.size > 60) mermaidCache.delete(mermaidCache.keys().next().value);
      }
      if (gen !== mermaidGen) return;
      b.innerHTML = out.svg || `<div class="mermaid-error">Diagram error: ${esc(out.error)}</div><pre>${esc(src)}</pre>`;
    }
  }

  /* ---------- PDF generation (pdfmake, no print dialog) ---------- */

  const MM_TO_PT = 72 / 25.4;
  const ALERT_COLORS = {
    'alert-note': ['#0969da', '#f0f6ff'],
    'alert-tip': ['#1a7f37', '#effaf2'],
    'alert-important': ['#8250df', '#f6f1ff'],
    'alert-warning': ['#9a6700', '#fff8e5'],
    'alert-caution': ['#cf222e', '#fff1f0'],
  };
  const BOX_LAYOUT = {
    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
    hLineColor: () => '#e1e5ea', vLineColor: () => '#e1e5ea',
    paddingLeft: () => 9, paddingRight: () => 9, paddingTop: () => 7, paddingBottom: () => 7,
  };
  const BAR_LAYOUT = {
    hLineWidth: () => 0, vLineWidth: () => 0,
    paddingLeft: (i) => (i === 0 ? 0 : 10), paddingRight: (i) => (i === 0 ? 0 : 6),
    paddingTop: () => 3, paddingBottom: () => 3,
  };
  const TOC_LAYOUT = {
    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
    hLineColor: () => '#e1e5ea', vLineColor: () => '#e1e5ea',
    paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 9, paddingBottom: () => 9,
  };

  function gridLayout(t) {
    return {
      hLineWidth: () => 0.5,
      vLineWidth: () => (t.vLines ? 0.5 : 0),
      hLineColor: (i) => (!t.vLines && i === 1 ? t.heading : t.grid),
      vLineColor: () => t.grid,
      paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
      fillColor: (row) => (row > 0 && row % 2 === 0 && t.zebra ? t.zebra : null),
    };
  }

  const GLYPHS = {
    '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>', '↑': '^', '↓': 'v',
    '─': '-', '━': '-', '│': '|', '┃': '|', '┌': '+', '┐': '+', '└': '+', '┘': '+',
    '├': '+', '┤': '+', '┬': '+', '┴': '+', '┼': '+', '═': '=', '║': '|',
    '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '☐': '[ ]', '☑': '[x]', '☒': '[x]',
  };
  const asciiGlyphs = (s) => s
    .replace(/[←-⇿─-╿✓-✗☐-☒]/g, (c) => GLYPHS[c] ?? '-')
    .replace(/[\u{1F000}-\u{1FAFF}☀-⛿]️?/gu, '')
    .replace(/️/g, '');

  async function imageToDataUrl(src) {
    if (/^data:image\/(png|jpe?g);/i.test(src)) return src;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      setTimeout(reject, 6000);
      img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/png'); // throws for cross-origin images without CORS
  }

  // rasterise a Mermaid SVG at 2.5x so it stays sharp in the PDF
  async function svgToPng(svg) {
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const w = vb[2] || parseFloat(svg.getAttribute('width')) || 600;
    const h = vb[3] || parseFloat(svg.getAttribute('height')) || 400;
    const clone = svg.cloneNode(true);
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    clone.removeAttribute('style');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      setTimeout(reject, 8000);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    });
    const scale = 2.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { src: canvas.toDataURL('image/png'), w, h };
  }

  // adjust the rendered HTML so html-to-pdfmake produces what the preview shows
  async function prepareHtml(html, ctx) {
    const box = document.createElement('div');
    box.innerHTML = html;
    box.querySelectorAll('input[type="checkbox"]').forEach((cb) =>
      cb.replaceWith(document.createTextNode(cb.hasAttribute('checked') ? '[x] ' : '[ ] ')));
    // inside a code block the box supplies the background; an inline-code highlight per line looks patchy
    box.querySelectorAll('pre > code').forEach((c) => c.replaceWith(...c.childNodes));
    box.querySelectorAll('ul.contains-task').forEach((ul) => ul.setAttribute('style', 'list-style-type:none'));
    box.querySelectorAll('hr').forEach((hr) =>
      hr.setAttribute('data-pdfmake', JSON.stringify({ width: ctx.width, color: ctx.theme.rule || '#e5e7eb', thickness: 0.6, margin: [0, 2, 0, 6] })));
    // the embedded fonts have no arrows, box-drawing or emoji glyphs; swap in text that renders
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const v = t.nodeValue;
      if (/[←-⇿─-╿✓-✗☐-☒\u{1F000}-\u{1FAFF}☀-⛿️]/u.test(v)) t.nodeValue = asciiGlyphs(v);
      // the monospace font is a Latin-only subset
      if (t.parentElement?.closest('code, pre')) t.nodeValue = t.nodeValue.replace(/[≤≥≠≈]/g, (c) => ({ '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~' })[c]);
    }
    // html-to-pdfmake keeps element ids but not a block's own classes, so tag blocks by id
    box.querySelectorAll('.page-break').forEach((d, k) => { d.textContent = ' '; d.id = `pdf-pagebreak-${k}`; });
    box.querySelectorAll('nav.toc').forEach((n, k) => {
      const d = document.createElement('div');
      d.id = `pdf-toc-${k}`;
      d.textContent = ' ';
      n.replaceWith(d);
    });
    box.querySelectorAll('div.alert').forEach((d, k) => {
      const kind = [...d.classList].find((c) => ALERT_COLORS[c]);
      if (kind) d.id = `pdf-${kind}-${k}`;
    });

    let missing = 0;
    for (const block of [...box.querySelectorAll('.mermaid-block')]) {
      const svg = block.querySelector('svg');
      const p = document.createElement('p');
      p.setAttribute('style', 'text-align:center');
      try {
        if (!svg) throw new Error('not rendered');
        const png = await svgToPng(svg);
        const img = document.createElement('img');
        img.setAttribute('src', png.src);
        img.setAttribute('width', String(Math.round(Math.min(png.w * 0.75, ctx.width))));
        p.append(img);
        block.replaceWith(p);
      } catch {
        missing++;
        const pre = document.createElement('pre');
        pre.textContent = block.dataset.src || block.textContent;
        block.replaceWith(pre);
      }
    }
    await Promise.all([...box.querySelectorAll('img:not([src^="data:image/png"])')].map(async (img) => {
      try {
        img.setAttribute('src', await imageToDataUrl(img.getAttribute('src') || ''));
      } catch {
        missing++;
        const em = document.createElement('em');
        em.textContent = `[image: ${img.getAttribute('alt') || img.getAttribute('src')}]`;
        img.replaceWith(em);
      }
    }));
    return { html: box.innerHTML, missing };
  }

  function sideBar(node, color, bg, ctx) {
    return {
      table: { widths: [2.5, '*'], body: [[{ text: '', fillColor: color }, bg ? { stack: [node], fillColor: bg } : { stack: [node] }]] },
      layout: BAR_LAYOUT,
      margin: [0, 0, 0, ctx.gap],
    };
  }

  // tag a heading and everything inside it, so the page-break check can tell "only heading left on this page"
  function markHeadline(node) {
    if (Array.isArray(node)) { node.forEach(markHeadline); return node; }
    if (!node || typeof node !== 'object') return node;
    node.headlineLevel = 1;
    ['stack', 'text', 'canvas'].forEach((k) => Array.isArray(node[k]) && node[k].forEach(markHeadline));
    return node;
  }

  function tocNode(ctx) {
    return {
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: 'Contents', bold: true, fontSize: ctx.base * 1.15, color: ctx.theme.heading, margin: [0, 0, 0, 6] },
            { toc: { numberStyle: { color: '#57606a' }, textMargin: [0, 1.5, 0, 1.5] } },
          ],
          fillColor: '#fafbfc',
        }]],
      },
      layout: TOC_LAYOUT,
      margin: [0, 0, 0, ctx.gap * 1.5],
    };
  }

  // walk html-to-pdfmake output and add the boxes, rules and table styling pdfmake can't take from CSS
  function shapeForPdf(node, ctx) {
    if (Array.isArray(node)) return node.map((n) => shapeForPdf(n, ctx));
    if (!node || typeof node !== 'object') return node;
    for (const key of ['stack', 'ul', 'ol', 'columns']) {
      if (Array.isArray(node[key])) node[key] = node[key].map((n) => shapeForPdf(n, ctx));
    }
    if (Array.isArray(node.text)) node.text = node.text.map((n) => shapeForPdf(n, ctx));
    if (node.table) {
      node.table.body = node.table.body.map((row) => row.map((c) => shapeForPdf(c, ctx)));
      if (node.nodeName === 'TABLE') {
        const cols = Math.max(...node.table.body.map((r) => r.length));
        node.table.widths = Array(cols).fill('*');
        if (node.table.body[0]?.[0]?.nodeName === 'TH') node.table.headerRows = 1;
        node.layout = gridLayout(ctx.theme);
        node.margin = [0, 0, 0, ctx.gap];
      }
    }
    if (typeof node.link === 'string' && node.link.startsWith('#')) {
      node.linkToDestination = decodeURIComponent(node.link.slice(1));
      delete node.link;
    }

    if (typeof node.id === 'string' && node.id.startsWith('pdf-')) {
      const tag = node.id;
      delete node.id;
      if (tag.startsWith('pdf-pagebreak-')) return { text: '', pageBreak: 'after' };
      if (tag.startsWith('pdf-toc-')) return tocNode(ctx);
      const kind = Object.keys(ALERT_COLORS).find((k) => tag.startsWith(`pdf-${k}-`));
      if (kind) return sideBar(node, ALERT_COLORS[kind][0], ALERT_COLORS[kind][1], ctx);
    }

    // headings listed in the table of contents
    if (/^H[1-6]$/.test(node.nodeName || '') && ctx.tocLevels.has(node.id)) {
      node.tocItem = true;
      node.tocMargin = [(ctx.tocLevels.get(node.id) - ctx.tocBase) * 14, 0, 0, 0];
      if (ctx.tocLevels.get(node.id) === ctx.tocBase) node.tocStyle = { bold: true };
    }

    // style lists include every ancestor's classes, so match blocks by their own element name
    const cls = [].concat(node.style || []);
    const t = ctx.theme;
    switch (node.nodeName) {
      case 'PRE':
        return { table: { widths: ['*'], body: [[{ stack: [node], fillColor: '#f6f8fa' }]] }, layout: BOX_LAYOUT, margin: [0, 0, 0, ctx.gap] };
      case 'BLOCKQUOTE':
        return sideBar(node, t.quote, null, ctx);
      case 'H1':
      case 'H2':
        if (!t.rule) return markHeadline(node);
        return markHeadline({
          stack: [node, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ctx.width, y2: 0, lineWidth: t.ruleWidth, lineColor: t.rule }], margin: [0, 1, 0, ctx.gap * 0.7] }],
        });
      case 'H3': case 'H4': case 'H5': case 'H6':
        return markHeadline(node);
      case 'P':
        if (cls.includes('alert-title')) {
          const kind = cls.find((c) => ALERT_COLORS[c]);
          if (kind) { node.color = ALERT_COLORS[kind][0]; node.bold = true; node.margin = [0, 0, 0, 3]; }
        }
        return node;
      default:
        if (node.image && !node.width && !node.fit) node.fit = [ctx.width, ctx.height * 0.75];
        return node;
    }
  }

  function coverNode(ctx, docTitle) {
    const c = coverInfo(docTitle);
    const a = ctx.theme.accent;
    const stack = [
      { text: c.title, fontSize: ctx.base * 2.6, bold: true, color: a, lineHeight: 1.1, margin: [0, ctx.height * 0.26, 0, 8] },
    ];
    if (c.subtitle) stack.push({ text: c.subtitle, fontSize: ctx.base * 1.35, color: '#57606a', margin: [0, 0, 0, 18] });
    stack.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: 60, h: 3, color: a }], margin: [0, 6, 0, 20] });
    if (c.author) stack.push({ text: c.author, fontSize: ctx.base * 1.1, bold: true });
    stack.push({ text: c.date, color: '#57606a', margin: [0, 3, 0, 0] });
    return { stack, pageBreak: 'after' };
  }

  function pdfFonts() {
    const fonts = {
      Roboto: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' },
    };
    fonts.RobotoMono = window.pdfMakeHasMono
      ? { normal: 'RobotoMono-400.woff', bold: 'RobotoMono-700.woff', italics: 'RobotoMono-400.woff', bolditalics: 'RobotoMono-700.woff' }
      : fonts.Roboto;
    return fonts;
  }

  async function buildPdfDefinition() {
    const t = theme();
    const base = Number(settings.size);
    const [wmm, hmm] = pageDims();
    const margin = parseFloat(settings.margin) * MM_TO_PT;
    const pageW = wmm * MM_TO_PT;
    const pageH = hmm * MM_TO_PT;
    const name = toFileName(ui.fileName.value);
    const docTitle = lastRender.title;

    const tocLevels = new Map();
    const wanted = new Set(lastRender.tocIds);
    for (const h of docEl.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (wanted.has(h.id)) tocLevels.set(h.id, Number(h.tagName.slice(1)));
    }
    const ctx = {
      width: pageW - 2 * margin, height: pageH - 2 * margin, gap: base * 0.8, base, theme: t,
      tocLevels, tocBase: tocLevels.size ? Math.min(...tocLevels.values()) : 1,
    };

    const prepared = await prepareHtml(docEl.innerHTML, ctx);
    const headingStyle = (scale, top, bottom) => ({ fontSize: base * scale, bold: true, color: t.heading, marginTop: top, marginBottom: bottom });
    const defaultStyles = {
      h1: headingStyle(2, base * 0.4, 2),
      h2: headingStyle(1.5, base * 1.1, 2),
      h3: headingStyle(1.25, base, base * 0.4),
      h4: headingStyle(1, base * 0.8, base * 0.3),
      h5: headingStyle(0.9, base * 0.8, base * 0.3),
      h6: { ...headingStyle(0.85, base * 0.8, base * 0.3), color: '#59636e' },
      p: { margin: [0, 0, 0, base * 0.8] },
      ul: { marginBottom: base * 0.8, marginLeft: 4 },
      ol: { marginBottom: base * 0.8, marginLeft: 4 },
      a: { color: t.link, decoration: '' },
      table: { marginBottom: base * 0.8 },
      th: { bold: true, fillColor: t.thBg || '', color: t.thColor },
      code: { background: '#eff1f4', fontSize: base * 0.85, font: 'RobotoMono' },
      pre: { fontSize: base * 0.8, lineHeight: 1.2, font: 'RobotoMono' },
      blockquote: { color: '#59636e' },
      mark: { background: '#fff3b0' },
    };
    if (!t.rule) defaultStyles.h2.marginBottom = base * 0.5;
    const content = shapeForPdf(htmlToPdfmake(prepared.html, { defaultStyles, removeExtraBlanks: true }), ctx);
    if (settings.cover) content.unshift(coverNode(ctx, docTitle));

    const styles = {};
    for (const [k, c] of Object.entries(HL)) styles[`hl-${k}`] = { color: c };
    styles['hl-com'].italics = true;

    const skip = (page) => settings.cover && page === 1;
    const definition = {
      pageSize: { width: pageW, height: pageH },
      pageMargins: [margin, margin, margin, margin],
      info: { title: name, creator: "Kishan's Dev Toolkit" },
      defaultStyle: { font: 'Roboto', fontSize: base, lineHeight: SPACING[settings.spacing] / 1.2, color: '#1f2328' },
      content,
      styles,
      // never leave a heading alone at the bottom of a page
      pageBreakBefore: (current, following) => !!current.headlineLevel && following.every((n) => n.headlineLevel),
    };
    const runMargin = Math.max(6, margin / 2 - 5);
    if (settings.headerText.trim()) {
      definition.header = (page, pages) => (skip(page) ? null : {
        text: fillTokens(settings.headerText, page, pages, docTitle),
        alignment: 'right', fontSize: 8, color: '#6e7781', margin: [margin, runMargin, margin, 0],
      });
    }
    const footText = settings.footerText.trim();
    if (footText || settings.pageNums) {
      definition.footer = (page, pages) => {
        if (skip(page)) return null;
        const num = settings.pageNums ? `${page} / ${pages}` : '';
        if (!footText) return { text: num, alignment: 'center', fontSize: 8, color: '#6e7781', margin: [margin, runMargin, margin, 0] };
        return {
          columns: [
            { text: fillTokens(settings.footerText, page, pages, docTitle), alignment: 'left' },
            { text: num, alignment: 'right', width: 'auto' },
          ],
          fontSize: 8, color: '#6e7781', margin: [margin, runMargin, margin, 0],
        };
      };
    }
    return { definition, name, missing: prepared.missing };
  }

  let building = false;
  async function downloadPdf() {
    if (!ui.input.value.trim()) { toast('Paste or write some Markdown first'); return; }
    if (typeof pdfMake === 'undefined' || typeof htmlToPdfmake === 'undefined') {
      toast('PDF library missing: keep the vendor folder next to index.html');
      return;
    }
    if (building) return;
    building = true;
    const label = ui.pdfBtn.textContent;
    ui.pdfBtn.textContent = 'Building PDF…';
    ui.pdfBtn.disabled = true;
    try {
      renderNow();
      await pendingMermaid;
      const { definition, name, missing } = await buildPdfDefinition();
      // pdfmake reports failures as unhandled rejections rather than through the callback
      await new Promise((resolve, reject) => {
        const onFail = (ev) => { ev.preventDefault?.(); cleanup(); reject(ev.reason || new Error('PDF generation failed')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('timed out')); }, 120000);
        const cleanup = () => { clearTimeout(timer); window.removeEventListener('unhandledrejection', onFail); };
        window.addEventListener('unhandledrejection', onFail);
        pdfMake.createPdf(definition, null, pdfFonts()).download(`${name}.pdf`, () => { cleanup(); resolve(); });
      });
      toast(missing
        ? `Downloaded ${name}.pdf (${missing} image${missing === 1 ? '' : 's'} or diagram${missing === 1 ? '' : 's'} could not be embedded)`
        : `Downloaded ${name}.pdf`);
    } catch (e) {
      console.error(e);
      toast(`Could not build the PDF: ${e.message || e}`);
    } finally {
      building = false;
      ui.pdfBtn.textContent = label;
      ui.pdfBtn.disabled = !ui.input.value.trim();
    }
  }

  /* ---------- HTML and .md export ---------- */

  function saveBlob(text, fileName, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Downloaded ${fileName}`);
  }

  async function exportHtml() {
    if (!ui.input.value.trim()) return;
    renderNow();
    await pendingMermaid;
    const name = toFileName(ui.fileName.value);
    const t = theme();
    const css = `${contentCss(t)}
body { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
.cover { min-height: 60vh; margin-bottom: 48px; padding-top: 12vh; border-bottom: 1px solid #e5e7eb; }`;
    const cover = settings.cover ? `<header class="cover">${coverHtml(lastRender.title)}</header>` : '';
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>${css}</style>
</head>
<body>
${cover}<article class="doc">
${docEl.innerHTML}
</article>
</body>
</html>
`;
    saveBlob(html, `${name}.html`, 'text/html');
  }

  function saveMarkdown() {
    if (!ui.input.value) { toast('Nothing to save yet'); return; }
    saveBlob(ui.input.value, `${toFileName(ui.fileName.value)}.md`, 'text/markdown');
  }

  /* ---------- files, full screen, keys ---------- */

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      ui.input.value = String(reader.result);
      ui.input.scrollTop = 0;
      ui.fileName.value = toFileName(file.name);
      nameEdited = true;
      renderNow();
      updateCaret();
      toast(`Loaded ${file.name}`);
    };
    reader.onerror = () => toast(`Could not read ${file.name}`);
    reader.readAsText(file);
  }

  const isFs = () => document.fullscreenElement === ui.panel || ui.panel.classList.contains('fs-fallback');
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (ui.panel.classList.contains('fs-fallback')) ui.panel.classList.remove('fs-fallback');
    else if (ui.panel.requestFullscreen) ui.panel.requestFullscreen().catch(() => ui.panel.classList.add('fs-fallback'));
    else ui.panel.classList.add('fs-fallback');
    setTimeout(updateFsLabel, 50);
  }
  function updateFsLabel() { ui.fsBtn.textContent = isFs() ? 'Exit full screen' : 'Full screen'; }

  function onKey(e) {
    if (document.body.dataset.view !== 'md') return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && e.shiftKey && key === 's') { e.preventDefault(); saveMarkdown(); }
    else if (mod && !e.shiftKey && (key === 's' || key === 'p')) { e.preventDefault(); downloadPdf(); }
    else if (mod && e.shiftKey && key === 'f') { e.preventDefault(); toggleFs(); }
    else if (e.key === 'Escape' && ui.panel.classList.contains('fs-fallback')) toggleFs();
  }

  /* ---------- wiring ---------- */

  ui.input.addEventListener('input', () => { scheduleRender(); updateCaret(); });
  ['keyup', 'click', 'select'].forEach((ev) => ui.input.addEventListener(ev, updateCaret));

  q('mdOpenBtn').addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', () => { loadFile(ui.fileInput.files[0]); ui.fileInput.value = ''; });
  q('mdSampleBtn').addEventListener('click', () => {
    ui.input.value = SAMPLE;
    nameEdited = false;
    renderNow();
    updateCaret();
  });
  q('mdClearBtn').addEventListener('click', () => {
    ui.input.value = '';
    nameEdited = false;
    renderNow();
    updateCaret();
    ui.input.focus();
  });
  q('mdSaveMdBtn').addEventListener('click', saveMarkdown);
  ui.fileName.addEventListener('input', () => { nameEdited = !!ui.fileName.value.trim(); });
  ui.pdfBtn.addEventListener('click', downloadPdf);
  ui.htmlBtn.addEventListener('click', exportHtml);
  ui.fsBtn.addEventListener('click', toggleFs);
  document.addEventListener('fullscreenchange', updateFsLabel);

  [...Object.values(selects), ui.pageNums, ui.cover, ui.accent].forEach((el) => el.addEventListener('change', () => onSettingsChange()));
  ui.accent.addEventListener('input', () => onSettingsChange(false));
  Object.values(texts).forEach((el) => el.addEventListener('input', () => onSettingsChange(false)));
  ui.moreBtn.addEventListener('click', () => {
    ui.more.hidden = !ui.more.hidden;
    ui.moreBtn.setAttribute('aria-expanded', String(!ui.more.hidden));
    ui.moreBtn.classList.toggle('active', !ui.more.hidden);
  });

  let dragDepth = 0;
  ui.inputPanel.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; ui.inputPanel.classList.add('dragging'); });
  ui.inputPanel.addEventListener('dragover', (e) => e.preventDefault());
  ui.inputPanel.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; ui.inputPanel.classList.remove('dragging'); } });
  ui.inputPanel.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    ui.inputPanel.classList.remove('dragging');
    loadFile(e.dataTransfer.files[0]);
  });

  document.addEventListener('keydown', onKey);
  fdoc.addEventListener('keydown', onKey);
  new ResizeObserver(updateFit).observe(ui.frame);
  // keep the preview backdrop in step with the app theme
  new MutationObserver(applyDocStyle).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyDocStyle);

  ui.input.value = store.get('md.draft') || '';
  applyDocStyle();
  renderNow();
  updateCaret();

  window.MdApp = { updateFit, renderNow, buildPdfDefinition, pdfFonts, whenDiagramsReady: () => pendingMermaid };
})();
