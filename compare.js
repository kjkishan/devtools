'use strict';

/* ================= JSON Compare tab ================= */

(() => {
  const q = (id) => document.getElementById(id);
  const ui = {
    left: q('cmpLeft'), right: q('cmpRight'), leftStatus: q('cmpLeftStatus'), rightStatus: q('cmpRightStatus'),
    sortKeys: q('cmpSortKeys'), onlyDiff: q('cmpOnlyDiff'), summary: q('cmpSummary'),
    changes: q('cmpChanges'), side: q('cmpSide'), status: q('cmpStatus'), panel: q('cmpResultPanel'), fsBtn: q('cmpFsBtn'),
  };
  const CONTEXT = 3;
  const MAX_ROWS = 20000;
  let mode = 'changes';
  let timer = null;

  const SAMPLE_LEFT = `{
  "service": "pricing-api",
  "version": "1.4.0",
  "replicas": 2,
  "features": { "cache": true, "audit": false },
  "regions": ["eu-west", "us-east"],
  "limits": { "rps": 100, "burst": 200 }
}`;
  const SAMPLE_RIGHT = `{
  "service": "pricing-api",
  "version": "1.5.0",
  "replicas": 3,
  "features": { "audit": true, "cache": true, "tracing": true },
  "regions": ["eu-west", "us-east", "ap-south"],
  "limits": { "rps": 100 }
}`;

  function parseSide(text) {
    if (!text.trim()) return null;
    try { return repairParse(text); } catch (e) { return { error: e.message }; }
  }

  function sideStatus(el, res) {
    if (!res) { el.textContent = 'Empty'; return; }
    if (res.error) { el.innerHTML = `<span class="bad">✕ ${esc(res.error)}</span>`; return; }
    el.innerHTML = res.fixes.length
      ? `<span class="ok">✓ Valid</span> · auto-fixed ${res.fixes.length} issue${res.fixes.length === 1 ? '' : 's'}`
      : '<span class="ok">✓ Valid JSON</span>';
  }

  const preview = (n) => (n ? Ast.compact(n, 120) : '');

  function renderChanges(list) {
    if (!list.length) {
      ui.changes.innerHTML = '<div class="cmp-empty">No differences: both documents contain the same data.</div>';
      return;
    }
    const label = { added: 'Added', removed: 'Removed', changed: 'Changed' };
    ui.changes.innerHTML = list.map((c) => {
      let vals;
      if (c.kind === 'added') vals = `<ins>${esc(preview(c.b))}</ins>`;
      else if (c.kind === 'removed') vals = `<del>${esc(preview(c.a))}</del>`;
      else vals = `<del>${esc(preview(c.a))}</del><span class="arrow">→</span><ins>${esc(preview(c.b))}</ins>`;
      return `<div class="chg chg-${c.kind}"><span class="badge">${label[c.kind]}</span><code class="path" title="Double-click to copy">${esc(c.path)}</code><span class="vals">${vals}</span></div>`;
    }).join('') + (list.length >= 5000 ? '<div class="cmp-empty">Showing the first 5,000 changes.</div>' : '');
  }

  // mark the part of two similar lines that differs
  function inlineDiff(a, b) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const wrap = (t) => `${esc(t.slice(0, p))}<mark>${esc(t.slice(p, t.length - s))}</mark>${esc(t.slice(t.length - s))}`;
    return [wrap(a), wrap(b)];
  }

  function sideRows(left, right) {
    const ops = JsonDiff.lines(left, right);
    const rows = [];
    let dels = [];
    let ins = [];
    const flush = () => {
      const n = Math.max(dels.length, ins.length);
      for (let k = 0; k < n; k++) {
        const l = dels[k];
        const r = ins[k];
        rows.push({ type: l !== undefined && r !== undefined ? 'chg' : l !== undefined ? 'del' : 'ins', l, r });
      }
      dels = [];
      ins = [];
    };
    for (const o of ops) {
      if (o.type === 'eq') { flush(); rows.push({ type: 'eq', l: o.a, r: o.b }); }
      else if (o.type === 'del') dels.push(o.a);
      else ins.push(o.b);
    }
    flush();
    return rows;
  }

  function renderSide(left, right) {
    const rows = sideRows(left, right);
    let show = rows.map(() => true);
    if (ui.onlyDiff.checked) {
      show = rows.map(() => false);
      rows.forEach((r, i) => {
        if (r.type === 'eq') return;
        for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) show[k] = true;
      });
    }
    const html = [];
    let hidden = 0;
    let count = 0;
    const flushGap = () => {
      if (hidden) html.push(`<tr class="r-gap"><td colspan="4">⋯ ${hidden.toLocaleString()} unchanged line${hidden === 1 ? '' : 's'}</td></tr>`);
      hidden = 0;
    };
    for (let i = 0; i < rows.length && count < MAX_ROWS; i++) {
      if (!show[i]) { hidden++; continue; }
      flushGap();
      count++;
      const r = rows[i];
      let lt = r.l !== undefined ? esc(left[r.l]) : '';
      let rt = r.r !== undefined ? esc(right[r.r]) : '';
      if (r.type === 'chg') [lt, rt] = inlineDiff(left[r.l], right[r.r]);
      html.push(`<tr class="r-${r.type}"><td class="ln">${r.l !== undefined ? r.l + 1 : ''}</td><td class="src l">${lt}</td>` +
        `<td class="ln">${r.r !== undefined ? r.r + 1 : ''}</td><td class="src r">${rt}</td></tr>`);
    }
    flushGap();
    if (!rows.some((r) => r.type !== 'eq')) {
      ui.side.innerHTML = '<div class="cmp-empty">The formatted documents are identical.</div>';
      return;
    }
    ui.side.innerHTML = `<table class="cmp-table"><colgroup><col class="ln"><col><col class="ln"><col></colgroup><tbody>${html.join('')}</tbody></table>` +
      (count >= MAX_ROWS ? '<div class="cmp-empty">Showing the first 20,000 lines.</div>' : '');
  }

  function compare() {
    clearTimeout(timer);
    const a = parseSide(ui.left.value);
    const b = parseSide(ui.right.value);
    sideStatus(ui.leftStatus, a);
    sideStatus(ui.rightStatus, b);
    if (!a?.value || !b?.value) {
      ui.summary.innerHTML = '';
      ui.status.textContent = '';
      const msg = '<div class="cmp-empty">Paste or open JSON on both sides to compare them.</div>';
      ui.changes.innerHTML = msg;
      ui.side.innerHTML = msg;
      return;
    }
    const t0 = performance.now();
    const list = JsonDiff.structural(a.value, b.value);
    const n = { added: 0, removed: 0, changed: 0 };
    for (const c of list) n[c.kind]++;
    ui.summary.innerHTML = list.length
      ? `<span class="chip chip-added">${n.added} added</span><span class="chip chip-removed">${n.removed} removed</span><span class="chip chip-changed">${n.changed} changed</span>`
      : '<span class="chip chip-same">Identical</span>';
    renderChanges(list);
    const indent = '  ';
    renderSide(stringify(a.value, indent, ui.sortKeys.checked).split('\n'), stringify(b.value, indent, ui.sortKeys.checked).split('\n'));
    ui.status.textContent = `Compared in ${Math.max(1, Math.round(performance.now() - t0))} ms · objects are matched by key, arrays by position`;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(compare, 300);
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll('#cmpModeSeg [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    ui.changes.hidden = mode !== 'changes';
    ui.side.hidden = mode !== 'side';
    q('cmpSideOpts').hidden = mode !== 'side';
  }

  function loadInto(ta, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { ta.value = String(reader.result); compare(); toast(`Loaded ${file.name}`); };
    reader.onerror = () => toast(`Could not read ${file.name}`);
    reader.readAsText(file);
  }

  function wireSide(ta, openBtn, fileInput, clearBtn, panel) {
    ta.addEventListener('input', schedule);
    openBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { loadInto(ta, fileInput.files[0]); fileInput.value = ''; });
    clearBtn.addEventListener('click', () => { ta.value = ''; compare(); ta.focus(); });
    let depth = 0;
    panel.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; panel.classList.add('dragging'); });
    panel.addEventListener('dragover', (e) => e.preventDefault());
    panel.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; panel.classList.remove('dragging'); } });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      panel.classList.remove('dragging');
      loadInto(ta, e.dataTransfer.files[0]);
    });
  }

  wireSide(ui.left, q('cmpLeftOpen'), q('cmpLeftFile'), q('cmpLeftClear'), q('cmpLeftPanel'));
  wireSide(ui.right, q('cmpRightOpen'), q('cmpRightFile'), q('cmpRightClear'), q('cmpRightPanel'));
  ui.sortKeys.addEventListener('change', compare);
  ui.onlyDiff.addEventListener('change', compare);
  q('cmpSwap').addEventListener('click', () => { [ui.left.value, ui.right.value] = [ui.right.value, ui.left.value]; compare(); });
  q('cmpSample').addEventListener('click', () => { ui.left.value = SAMPLE_LEFT; ui.right.value = SAMPLE_RIGHT; compare(); });
  document.querySelectorAll('#cmpModeSeg [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  ui.changes.addEventListener('dblclick', (e) => {
    const p = e.target.closest('.path');
    if (p) copyText(p.textContent, `Copied ${p.textContent}`);
  });

  const isFs = () => document.fullscreenElement === ui.panel || ui.panel.classList.contains('fs-fallback');
  ui.fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (ui.panel.classList.contains('fs-fallback')) ui.panel.classList.remove('fs-fallback');
    else if (ui.panel.requestFullscreen) ui.panel.requestFullscreen().catch(() => ui.panel.classList.add('fs-fallback'));
    else ui.panel.classList.add('fs-fallback');
    setTimeout(() => { ui.fsBtn.textContent = isFs() ? 'Exit full screen' : 'Full screen'; }, 50);
  });
  document.addEventListener('fullscreenchange', () => { ui.fsBtn.textContent = isFs() ? 'Exit full screen' : 'Full screen'; });
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view === 'compare' && e.key === 'Escape' && ui.panel.classList.contains('fs-fallback')) ui.fsBtn.click();
  });

  setMode('changes');
  compare();
})();
