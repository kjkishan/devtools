'use strict';

/* ================================================================
   Lenient JSON parser — parses JSON and repairs common mistakes.
   Returns an AST that keeps the raw number/string text, so large
   numbers never lose precision and key order is preserved.
   Node shapes: {t:'o', entries:[{k, v}]}, {t:'a', items:[]},
                {t:'s', raw}, {t:'n', raw}, {t:'l', raw}
   ================================================================ */

const WS_RE = /\s/;
const QUOTE_CLOSERS = {
  '"': '"', "'": "'", '`': '`',
  '“': '“”', '”': '“”',
  '‘': '‘’', '’': '‘’',
};
const DELIMS = ',:[]{}()"\'`/;=';
const HEX_RE = /-?0[xX][0-9a-fA-F]+/y;
const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const WORD_RE = /-?[A-Za-z_$][\w$]*/y;
const JSONP_RE = /[A-Za-z_$][\w$.]*\s*\(/y;
const KEYWORDS = new Map([
  ['true', 'true'], ['True', 'true'], ['TRUE', 'true'],
  ['false', 'false'], ['False', 'false'], ['FALSE', 'false'],
  ['null', 'null'], ['Null', 'null'], ['NULL', 'null'], ['None', 'null'], ['nil', 'null'],
  ['undefined', 'null'], ['NaN', 'null'], ['Infinity', 'null'], ['-Infinity', 'null'],
]);
const isQuote = (c) => Object.prototype.hasOwnProperty.call(QUOTE_CLOSERS, c);

function repairParse(src) {
  const s = src;
  const len = s.length;
  const fixes = [];
  const stack = [];
  let i = 0;

  const fix = (pos, msg) => { fixes.push({ pos, msg }); };
  const isDelim = (ch) => ch === undefined || WS_RE.test(ch) || DELIMS.includes(ch);
  const matchAt = (re) => { re.lastIndex = i; const m = re.exec(s); return m ? m[0] : null; };

  function skipWs() {
    while (i < len) {
      const c = s[i];
      if (WS_RE.test(c)) {
        i++;
      } else if (c === '/' && s[i + 1] === '/') {
        fix(i, 'Removed // comment');
        const nl = s.indexOf('\n', i);
        i = nl < 0 ? len : nl;
      } else if (c === '/' && s[i + 1] === '*') {
        fix(i, 'Removed /* */ comment');
        const end = s.indexOf('*/', i + 2);
        i = end < 0 ? len : end + 2;
      } else {
        return;
      }
    }
  }

  function parseString() {
    const start = i;
    const open = s[i++];
    const closers = QUOTE_CLOSERS[open];
    if (open !== '"') fix(start, `Replaced ${open} quotes with "`);
    let out = '';
    while (true) {
      if (i >= len) { fix(i, 'Added missing closing quote'); break; }
      const c = s[i];
      if (closers.includes(c)) { i++; break; }
      if (c === '\\') {
        const n = s[i + 1];
        if (n === undefined) { i++; continue; }
        if ('"\\/bfnrt'.includes(n)) { out += c + n; i += 2; continue; }
        if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(s.substr(i + 2, 4))) { out += s.substr(i, 6); i += 6; continue; }
        if (n === "'" || n === '`') { fix(i, `Removed unneeded escape before ${n}`); out += n; i += 2; continue; }
        if (n === '\n' || n === '\r') {
          fix(i, 'Joined line continuation');
          i += 2;
          if (n === '\r' && s[i] === '\n') i++;
          continue;
        }
        fix(i, 'Escaped stray backslash');
        out += '\\\\';
        i++;
        continue;
      }
      if (c === '\n' || c === '\r') {
        if (open === '`') { out += c === '\n' ? '\\n' : '\\r'; i++; continue; }
        // a raw line break is never valid inside a JSON string, so treat it as a missing closing quote
        fix(i, 'Added missing closing quote');
        out = out.replace(/\s*,\s*$/, '');
        break;
      }
      if (c === '"') { out += '\\"'; i++; continue; }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        fix(i, 'Escaped control character');
        out += c === '\t' ? '\\t' : '\\u' + code.toString(16).padStart(4, '0');
        i++;
        continue;
      }
      out += c;
      i++;
    }
    return '"' + out + '"';
  }

  function normalizeNumber(tok, pos) {
    let t = tok;
    if (t[0] === '+') { t = t.slice(1); fix(pos, 'Removed leading + from number'); }
    const neg = t[0] === '-';
    let body = neg ? t.slice(1) : t;
    if (/^0\d/.test(body)) {
      if (!/[.eE]/.test(body)) {
        fix(pos, `Quoted ${tok} (numbers can't have leading zeros)`);
        return { t: 's', raw: JSON.stringify(tok) };
      }
      body = body.replace(/^0+(?=\d)/, '');
      fix(pos, 'Removed leading zeros from number');
    }
    if (body[0] === '.') { body = '0' + body; fix(pos, 'Added leading 0 to number'); }
    if (/\.(?!\d)/.test(body)) { body = body.replace('.', ''); fix(pos, 'Removed trailing "." from number'); }
    return { t: 'n', raw: (neg ? '-' : '') + body };
  }

  function parseBare() {
    const start = i;
    let tok = matchAt(HEX_RE);
    if (tok && isDelim(s[i + tok.length])) {
      i += tok.length;
      fix(start, `Converted hex ${tok} to decimal`);
      return { t: 'n', raw: String(parseInt(tok, 16)) };
    }
    tok = matchAt(NUM_RE);
    if (tok && isDelim(s[i + tok.length])) {
      i += tok.length;
      return normalizeNumber(tok, start);
    }
    tok = matchAt(WORD_RE);
    if (tok && isDelim(s[i + tok.length]) && KEYWORDS.has(tok)) {
      i += tok.length;
      const v = KEYWORDS.get(tok);
      if (v !== tok) fix(start, `Replaced ${tok} with ${v}`);
      return { t: 'l', raw: v };
    }
    // unquoted text: read to the end of the value
    let j = i;
    while (j < len) {
      const c = s[j];
      if (c === ',' || c === ']' || c === '}' || c === '\n' || c === '\r') break;
      if (c === '/' && (s[j + 1] === '/' || s[j + 1] === '*') && WS_RE.test(s[j - 1] || ' ')) break;
      j++;
    }
    const text = s.slice(i, j).trim();
    if (!text) return undefined;
    fix(start, 'Added quotes around unquoted text');
    i = j;
    return { t: 's', raw: JSON.stringify(text) };
  }

  function parseValue() {
    skipWs();
    if (i >= len) return undefined;
    const c = s[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (isQuote(c)) return { t: 's', raw: parseString() };
    if (',:]})'.includes(c)) return undefined;
    return parseBare();
  }

  function readCommas() {
    let n = 0;
    let pos = -1;
    skipWs();
    while (s[i] === ',') {
      if (pos < 0) pos = i;
      n++;
      i++;
      skipWs();
    }
    return { n, pos };
  }

  function checkCommas(sep, count) {
    if (count === 0 && sep.n) fix(sep.pos, 'Removed leading comma');
    else if (count > 0 && sep.n === 0) fix(i, 'Inserted missing comma');
    else if (sep.n > 1) fix(sep.pos, 'Removed extra comma');
  }

  // Wrong closing bracket: close the current container if an outer one expects it, else drop it
  function closesParent(c, expected) {
    if ((c === '}' || c === ']') && stack.lastIndexOf(c) !== -1) {
      fix(i, `Added missing '${expected}'`);
      return true;
    }
    fix(i, `Removed unexpected '${c}'`);
    i++;
    return false;
  }

  function parseObject() {
    i++;
    stack.push('}');
    const entries = [];
    while (true) {
      const sep = readCommas();
      if (i >= len) {
        if (sep.n) fix(sep.pos, 'Removed trailing comma');
        fix(i, "Added missing '}'");
        break;
      }
      const c = s[i];
      if (c === '}') {
        if (sep.n) fix(sep.pos, 'Removed trailing comma');
        i++;
        break;
      }
      if (c === ']' || c === ')') {
        if (sep.n) fix(sep.pos, 'Removed trailing comma');
        if (closesParent(c, '}')) break;
        continue;
      }
      if (c === ':') { fix(i, "Removed unexpected ':'"); i++; continue; }
      checkCommas(sep, entries.length);

      let key;
      let generatedKey = false;
      if (isQuote(c)) {
        key = parseString();
      } else if (c === '{' || c === '[') {
        key = JSON.stringify(`key_${entries.length + 1}`);
        generatedKey = true;
        fix(i, `Added missing key ${key}`);
      } else {
        let j = i;
        while (j < len && !':,{}[]"\'=\n\r'.includes(s[j])) j++;
        const text = s.slice(i, j).trim();
        if (!text) { fix(i, `Removed unexpected '${c}'`); i++; continue; }
        fix(i, 'Added quotes around key');
        key = JSON.stringify(text);
        i = j;
      }

      skipWs();
      if (s[i] === ':') i++;
      else if (s[i] === '=') { fix(i, "Replaced '=' with ':'"); i++; }
      else if (!generatedKey) fix(i, "Inserted missing ':'");

      let v = parseValue();
      if (v === undefined) { fix(i, 'Filled missing value with null'); v = { t: 'l', raw: 'null' }; }
      entries.push({ k: key, v });
    }
    stack.pop();
    return { t: 'o', entries };
  }

  function parseArray() {
    i++;
    stack.push(']');
    const items = [];
    while (true) {
      const sep = readCommas();
      if (i >= len) {
        if (sep.n) fix(sep.pos, 'Removed trailing comma');
        fix(i, "Added missing ']'");
        break;
      }
      const c = s[i];
      if (c === ']') {
        if (sep.n) fix(sep.pos, 'Removed trailing comma');
        i++;
        break;
      }
      if (c === '}' || c === ')') {
        if (sep.n) fix(sep.pos, 'Removed trailing comma');
        if (closesParent(c, ']')) break;
        continue;
      }
      if (c === ':') { fix(i, "Removed unexpected ':'"); i++; continue; }
      checkCommas(sep, items.length);
      const v = parseValue();
      if (v === undefined) { fix(i, `Removed unexpected '${s[i]}'`); i++; continue; }
      items.push(v);
    }
    stack.pop();
    return { t: 'a', items };
  }

  // ---- root ----
  if (s[0] === '﻿') fix(0, 'Removed byte-order mark');
  skipWs();
  if (s.startsWith('```', i)) {
    fix(i, 'Removed ``` code fence');
    const nl = s.indexOf('\n', i);
    i = nl < 0 ? len : nl + 1;
    skipWs();
  }
  const jsonp = matchAt(JSONP_RE);
  if (jsonp) {
    fix(i, 'Removed JSONP wrapper');
    i += jsonp.length;
  } else if (i < len && !/[{["'`“”‘’\d.+-]/.test(s[i])) {
    const word = matchAt(WORD_RE);
    const k = s.slice(i).search(/[{[]/);
    if (!(word && KEYWORDS.has(word)) && k > 0) {
      fix(i, 'Removed text before the JSON');
      i += k;
    }
  }

  const STRAY = ',:]})`;';
  const values = [];
  while (true) {
    skipWs();
    if (i >= len) break;
    if (STRAY.includes(s[i])) {
      const start = i;
      while (i < len && (STRAY.includes(s[i]) || WS_RE.test(s[i]))) i++;
      fix(start, `Removed unexpected '${s.slice(start, i).trim()}'`);
      continue;
    }
    const v = parseValue();
    if (v === undefined) i++;
    else values.push(v);
  }

  if (!values.length) throw new Error('No JSON value found in the input.');
  let root = values[0];
  if (values.length > 1) {
    const containers = values.filter((v) => v.t === 'o' || v.t === 'a');
    if (containers.length && containers.length < values.length) {
      fix(0, 'Removed text outside the JSON');
      root = containers.length === 1 ? containers[0] : { t: 'a', items: containers };
    } else {
      fix(0, `Wrapped ${values.length} top-level values in an array`);
      root = { t: 'a', items: values };
    }
  }
  return { value: root, fixes };
}

/* ================= Serialisation ================= */

function sortedEntries(node, sort) {
  if (!sort) return node.entries;
  return [...node.entries].sort((a, b) => a.k.localeCompare(b.k));
}

function stringify(root, indent, sort) {
  const parts = [];
  const nl = indent ? '\n' : '';
  const colon = indent ? ': ' : ':';
  const pad = (d) => (indent ? indent.repeat(d) : '');

  (function write(n, d) {
    if (n.t === 'o') {
      if (!n.entries.length) { parts.push('{}'); return; }
      parts.push('{');
      sortedEntries(n, sort).forEach((e, idx) => {
        if (idx) parts.push(',');
        parts.push(nl, pad(d + 1), e.k, colon);
        write(e.v, d + 1);
      });
      parts.push(nl, pad(d), '}');
    } else if (n.t === 'a') {
      if (!n.items.length) { parts.push('[]'); return; }
      parts.push('[');
      n.items.forEach((v, idx) => {
        if (idx) parts.push(',');
        parts.push(nl, pad(d + 1));
        write(v, d + 1);
      });
      parts.push(nl, pad(d), ']');
    } else {
      parts.push(n.raw);
    }
  })(root, 0);

  return parts.join('');
}

function statsOf(root) {
  let objects = 0, arrays = 0, values = 0, depth = 0;
  const st = [[root, 1]];
  while (st.length) {
    const [n, d] = st.pop();
    if (n.t === 'o') { objects++; depth = Math.max(depth, d); for (const e of n.entries) st.push([e.v, d + 1]); }
    else if (n.t === 'a') { arrays++; depth = Math.max(depth, d); for (const v of n.items) st.push([v, d + 1]); }
    else values++;
  }
  return { objects, arrays, values, depth };
}

/* ================= Helpers ================= */

const esc = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function lineNumbers(count) {
  const a = new Array(count);
  for (let k = 0; k < count; k++) a[k] = k + 1;
  return a.join('\n');
}

function countLines(text) {
  let n = 1;
  for (let k = text.indexOf('\n'); k !== -1; k = text.indexOf('\n', k + 1)) n++;
  return n;
}

function makeLocator(text) {
  const starts = [0];
  for (let k = text.indexOf('\n'); k !== -1; k = text.indexOf('\n', k + 1)) starts.push(k + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: pos - starts[lo] + 1 };
  };
}

function strictError(text) {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const msg = String(e.message || e);
    let pos = null;
    let m = /position (\d+)/i.exec(msg);
    if (m) {
      pos = Number(m[1]);
    } else if ((m = /line (\d+) column (\d+)/i.exec(msg))) {
      const lines = text.split('\n');
      pos = lines.slice(0, Number(m[1]) - 1).reduce((acc, l) => acc + l.length + 1, 0) + Number(m[2]) - 1;
    }
    const clean = msg
      .replace(/^JSON\.parse:\s*/, '')
      .replace(/,\s*".*" is not valid JSON$/s, '')
      .replace(/\s*(in JSON )?at position \d+.*$/s, '')
      .replace(/\s*at line \d+ column \d+ of the JSON data$/, '');
    return { msg: clean.length > 160 ? clean.slice(0, 160) + '…' : clean, pos };
  }
}

function highlight(json) {
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(json))) {
    if (m.index > last) out += esc(json.slice(last, m.index));
    if (m[1]) out += `<span class="${m[2] ? 'k' : 's'}">${esc(m[1])}</span>${m[2] || ''}`;
    else if (m[3]) out += `<span class="n">${m[3]}</span>`;
    else if (m[4]) out += `<span class="b">${m[4]}</span>`;
    else if (m[5]) out += '<span class="z">null</span>';
    else out += `<span class="p">${m[6]}</span>`;
    last = re.lastIndex;
  }
  return out + esc(json.slice(last));
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/* ================= UI ================= */

const $ = (id) => document.getElementById(id);
const els = {
  input: $('input'), inGutter: $('inGutter'), inStatus: $('inStatus'), inputPanel: $('inputPanel'),
  fileInput: $('fileInput'), outputPanel: $('outputPanel'), notice: $('notice'),
  codeView: $('codeView'), outGutter: $('outGutter'), codeOut: $('codeOut'), treeView: $('treeView'),
  empty: $('emptyState'), outStatus: $('outStatus'),
  prettyBtn: $('prettyBtn'), minifyBtn: $('minifyBtn'), indentSel: $('indentSel'),
  autoFix: $('autoFix'), sortKeys: $('sortKeys'),
  copyBtn: $('copyBtn'), downloadBtn: $('downloadBtn'), fsBtn: $('fsBtn'), toast: $('toast'),
  tableView: $('tableView'), graphView: $('graphView'), convertView: $('convertView'), convertOut: $('convertOut'),
  searchInput: $('searchInput'), searchCount: $('searchCount'),
  queryInput: $('queryInput'), queryMode: $('queryMode'), queryStatus: $('queryStatus'),
  tableSource: $('tableSource'), tableInfo: $('tableInfo'), graphInfo: $('graphInfo'),
  convertFormat: $('convertFormat'), convertInfo: $('convertInfo'),
};

const LIVE_LIMIT = 1_500_000;      // characters: above this, format only on demand
const HIGHLIGHT_LIMIT = 3_000_000; // characters: above this, show plain text
const TREE_CHUNK = 500;            // children rendered per "show more"

const VIEWS = ['code', 'tree', 'table', 'graph', 'convert'];

const state = {
  mode: 'pretty',
  view: VIEWS.includes(store.get('jf.view')) ? store.get('jf.view') : 'code',
  output: '',
  ast: null,       // what the viewer shows (query result when a query is active)
  fullAst: null,   // the whole parsed document
  query: '',
  version: 0,
  rendered: {},    // view name -> version it last rendered
  tablePath: '$',
  tableSort: { col: -1, dir: 1 },
  converted: '',
  baseName: 'data',
  fontSize: Number(store.get('jf.fontSize')) || 13,
};

const SAMPLE = `// Sample with common mistakes: Auto-fix repairs all of them
{
  name: 'Sample project',
  "version": 2.0,
  "active": True,
  "tags": ["json", "formatter",],
  "owner": { "id": 42 "email": "team@example.com" },
  "items": [
    {"sku": "A-100", "price": .99},
    {"sku": "B-200", "price": 12.50, "stock": undefined}
  ],
  "notes": None,
  "matrix": [[1, 2], [3, 4]
`;

function indentString() {
  const v = els.indentSel.value;
  return v === 'tab' ? '\t' : ' '.repeat(Number(v));
}

function run() {
  const text = els.input.value;
  hideNotice();
  if (!text.trim()) {
    setOutput(null);
    els.outStatus.textContent = '';
    return;
  }

  const t0 = performance.now();
  let res;
  try {
    res = repairParse(text);
  } catch (e) {
    setOutput(null);
    showNotice('error', `<strong>Could not read the input.</strong> ${esc(e.message)}`);
    els.outStatus.innerHTML = '<span class="bad">Invalid</span>';
    return;
  }
  const locate = makeLocator(text);

  if (!els.autoFix.checked) {
    const err = strictError(text);
    if (err) {
      setOutput(null);
      const pos = err.pos ?? res.fixes[0]?.pos ?? text.length;
      const { line, col } = locate(pos);
      const n = res.fixes.length;
      const actions = [['Go to error', () => selectInput(pos)]];
      if (n) actions.push([`Auto-fix ${n === 1 ? 'it' : 'them'}`, () => { els.autoFix.checked = true; run(); }]);
      showNotice('error',
        `<strong>Invalid JSON</strong> at line ${line}, column ${col}: ${esc(err.msg)}` +
        (n ? ` <span class="muted">Auto-fix can repair ${plural(n, 'issue')}.</span>` : ''),
        actions);
      els.outStatus.innerHTML = `<span class="bad">✕ Invalid JSON</span> · line ${line}, column ${col}`;
      return;
    }
  }

  const indent = state.mode === 'minify' ? '' : indentString();
  state.fullAst = res.value;
  state.ast = applyQuery(res.value);
  setOutput(stringify(state.ast, indent, els.sortKeys.checked));

  const fixes = els.autoFix.checked ? res.fixes : [];
  if (fixes.length) showFixes(fixes, locate);
  renderStatus(fixes.length, performance.now() - t0);
}

function setOutput(text) {
  const has = text != null;
  state.version++;
  state.output = has ? text : '';
  if (!has) { state.ast = null; state.fullAst = null; }
  els.empty.hidden = has;
  els.copyBtn.disabled = !has;
  els.downloadBtn.disabled = !has;
  if (!has) {
    for (const el of [els.codeOut, els.outGutter, els.treeView, els.tableView, els.graphView, els.convertOut]) el.textContent = '';
  }
  renderView();
}

/* ---------- JSONPath query ---------- */

function applyQuery(ast) {
  els.queryInput.classList.toggle('active', !!state.query);
  if (!state.query) { setQueryStatus(''); return ast; }
  try {
    const hits = JsonPath.query(ast, state.query);
    setQueryStatus(`${hits.length.toLocaleString()} match${hits.length === 1 ? '' : 'es'}`, 'ok');
    const items = els.queryMode.value === 'paths'
      ? hits.map((h) => ({ t: 's', raw: JSON.stringify(h.path) }))
      : hits.map((h) => h.node);
    return { t: 'a', items };
  } catch (e) {
    setQueryStatus(e.message, 'bad');
    return ast;
  }
}

function setQueryStatus(text, kind = '') {
  els.queryStatus.textContent = text;
  els.queryStatus.className = `count ${kind}`;
}

function runQuery() {
  state.query = els.queryInput.value.trim();
  run();
}

/* ---------- views ---------- */

const viewEls = () => ({ code: els.codeView, tree: els.treeView, table: els.tableView, graph: els.graphView, convert: els.convertView });
const renderers = { code: renderCode, tree: renderTree, table: renderTable, graph: renderGraph, convert: renderConvert };

function setView(name) {
  state.view = VIEWS.includes(name) ? name : 'code';
  store.set('jf.view', state.view);
  renderView();
}

function renderView() {
  const has = !!state.ast;
  for (const [name, el] of Object.entries(viewEls())) el.hidden = !has || name !== state.view;
  document.querySelectorAll('#viewSeg [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  document.querySelectorAll('#outputPanel [data-for-view]').forEach((el) => { el.hidden = !has || el.dataset.forView !== state.view; });
  if (!has) { runSearch(); return; }
  renderers[state.view]();
  runSearch(true);
}

// true when the view is already showing the current output
function isFresh(view) {
  if (state.rendered[view] === state.version) return true;
  state.rendered[view] = state.version;
  return false;
}

function renderCode() {
  if (isFresh('code')) return;
  const out = state.output;
  els.outGutter.textContent = lineNumbers(countLines(out));
  if (out.length > HIGHLIGHT_LIMIT) els.codeOut.textContent = out;
  else els.codeOut.innerHTML = highlight(out);
  els.codeView.scrollTop = 0;
}

function renderStatus(fixCount, ms) {
  const st = statsOf(state.ast);
  const bits = [
    fixCount ? `<span class="ok">✓ Repaired JSON</span>` : `<span class="ok">✓ Valid JSON</span>`,
    plural(st.objects, 'object'),
    plural(st.arrays, 'array'),
    plural(st.values, 'value'),
    `depth ${st.depth}`,
    formatBytes(new Blob([state.output]).size),
    `${Math.max(1, Math.round(ms))} ms`,
  ];
  if (state.output.length > HIGHLIGHT_LIMIT && state.view === 'code') bits.push('highlighting off (large file)');
  els.outStatus.innerHTML = bits.join(' · ');
}

/* ---------- notices ---------- */

function hideNotice() {
  els.notice.hidden = true;
  els.notice.textContent = '';
}

function showNotice(kind, html, actions = [], extra = null) {
  els.notice.className = `notice ${kind}`;
  els.notice.textContent = '';
  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.innerHTML = html;
  els.notice.append(msg);
  for (const [label, handler] of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => handler(b));
    els.notice.append(b);
  }
  if (extra) els.notice.append(extra);
  els.notice.hidden = false;
}

function showFixes(fixes, locate) {
  const groups = new Map();
  for (const f of fixes) {
    groups.set(f.msg, (groups.get(f.msg) || 0) + 1);
  }
  const top = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m, n]) => (n > 1 ? `${esc(m.toLowerCase())} ×${n}` : esc(m.toLowerCase())));
  const more = groups.size > 3 ? ', …' : '';

  const list = document.createElement('ol');
  list.className = 'fix-list';
  list.hidden = true;
  const LIMIT = 500;
  for (const f of fixes.slice(0, LIMIT)) {
    const { line, col } = locate(f.pos);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Show in input';
    b.innerHTML = `<span class="loc">Ln ${line}, Col ${col}</span>${esc(f.msg)}`;
    b.addEventListener('click', () => selectInput(f.pos));
    li.append(b);
    list.append(li);
  }
  if (fixes.length > LIMIT) {
    const li = document.createElement('li');
    li.textContent = `…and ${(fixes.length - LIMIT).toLocaleString()} more`;
    list.append(li);
  }

  showNotice('warn',
    `<strong>Auto-fixed ${plural(fixes.length, 'issue')}</strong> <span class="muted">(${top.join(', ')}${more}). Check the result.</span>`,
    [
      ['Show details', (b) => { list.hidden = !list.hidden; b.textContent = list.hidden ? 'Show details' : 'Hide details'; }],
      ['Apply to input', () => {
        els.input.value = stringify(state.fullAst, indentString(), els.sortKeys.checked);
        onInputChanged(false);
        run();
        toast('Input replaced with the repaired JSON');
      }],
    ],
    list);
}

/* ---------- tree view ---------- */

function childPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function leafClass(n) {
  if (n.t === 's') return 's';
  if (n.t === 'n') return 'n';
  return n.raw === 'null' ? 'z' : 'b';
}

function treeNode(node, label, path, depth) {
  const labelHtml = label == null ? '' :
    (label.index ? `<span class="idx">${label.text}</span>` : `<span class="k">${esc(label.text)}</span>`) +
    '<span class="p">: </span>';

  if (node.t !== 'o' && node.t !== 'a') {
    const div = document.createElement('div');
    div.className = 'leaf';
    div.dataset.path = path;
    div.innerHTML = `${labelHtml}<span class="${leafClass(node)}">${esc(node.raw)}</span>`;
    return div;
  }

  const isObj = node.t === 'o';
  const children = isObj ? sortedEntries(node, els.sortKeys.checked) : node.items;
  const count = children.length;
  const d = document.createElement('details');
  const sum = document.createElement('summary');
  sum.dataset.path = path;
  sum.innerHTML = labelHtml +
    `<span class="p">${isObj ? '{' : '['}</span>` +
    (count ? `<span class="meta">${plural(count, isObj ? 'key' : 'item')}</span>` : '') +
    `<span class="p">${isObj ? '}' : ']'}</span>`;
  d.append(sum);
  if (!count) {
    d.classList.add('empty-node');
    sum.addEventListener('click', (e) => e.preventDefault());
    return d;
  }

  let kids = null;
  let shown = 0;
  let moreBtn = null;
  const renderMore = () => {
    const end = Math.min(shown + TREE_CHUNK, count);
    const frag = document.createDocumentFragment();
    for (let k = shown; k < end; k++) {
      if (isObj) {
        const e = children[k];
        let keyText;
        try { keyText = JSON.parse(e.k); } catch { keyText = e.k; }
        frag.append(treeNode(e.v, { text: e.k }, childPath(path, keyText), depth + 1));
      } else {
        frag.append(treeNode(children[k], { text: String(k), index: true }, `${path}[${k}]`, depth + 1));
      }
    }
    shown = end;
    if (moreBtn) moreBtn.remove();
    kids.append(frag);
    if (shown < count) {
      moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'more';
      moreBtn.textContent = `Show ${Math.min(TREE_CHUNK, count - shown).toLocaleString()} more of ${(count - shown).toLocaleString()}`;
      moreBtn.addEventListener('click', renderMore);
      kids.append(moreBtn);
    }
  };
  d.renderKids = () => {
    if (kids) return;
    kids = document.createElement('div');
    kids.className = 'kids';
    d.append(kids);
    renderMore();
  };
  d.addEventListener('toggle', () => { if (d.open) d.renderKids(); });
  if (depth < 2) { d.open = true; d.renderKids(); }
  return d;
}

function renderTree() {
  if (isFresh('tree')) return;
  els.treeView.textContent = '';
  els.treeView.append(treeNode(state.ast, null, '$', 0));
  els.treeView.scrollTop = 0;
}

function expandAll() {
  const LIMIT = 20000;
  let opened = 0;
  let pending;
  while ((pending = els.treeView.querySelectorAll('details:not([open]):not(.empty-node)')).length) {
    for (const d of pending) {
      d.open = true;
      d.renderKids();
      if (++opened >= LIMIT) { toast(`Expanded the first ${LIMIT.toLocaleString()} nodes`); return; }
    }
  }
}

function collapseAll() {
  els.treeView.querySelectorAll('details[open]').forEach((d) => { d.open = false; });
  const root = els.treeView.querySelector('details');
  if (root) root.open = true;
}

/* ---------- table view ---------- */

const TABLE_LIMIT = 2000;

function tableSource() {
  const sources = JsonTable.sources(state.ast);
  const pick = sources.find((s) => s.path === state.tablePath) || sources[0];
  state.tablePath = pick.path;
  return { sources, pick };
}

function compareCells(a, b) {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  if (a.t === 'n' && b.t === 'n') return Number(a.raw) - Number(b.raw);
  const x = Ast.isContainer(a) ? stringify(a, '', false) : Ast.text(a);
  const y = Ast.isContainer(b) ? stringify(b, '', false) : Ast.text(b);
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}

function renderTable() {
  if (isFresh('table')) return;
  const { sources, pick } = tableSource();
  els.tableSource.innerHTML = sources
    .map((s) => `<option value="${esc(s.path).replace(/"/g, '&quot;')}"${s === pick ? ' selected' : ''}>${esc(s.path)} (${Ast.size(s.node) || 1})</option>`)
    .join('');

  const { cols, rows } = JsonTable.build(pick.node);
  const sort = state.tableSort;
  if (sort.col >= cols.length) sort.col = -1;
  const order = rows.map((_, i) => i);
  if (sort.col >= 0) order.sort((i, j) => compareCells(rows[i][sort.col], rows[j][sort.col]) * sort.dir);

  const head = cols.map((c, i) => {
    const cls = i === sort.col ? (sort.dir > 0 ? 'asc' : 'desc') : '';
    return `<th data-col="${i}" class="${cls}" title="Sort by ${esc(String(c)).replace(/"/g, '&quot;')}">${esc(String(c))}</th>`;
  }).join('');
  const body = order.slice(0, TABLE_LIMIT).map((r) => {
    const cells = rows[r].map((v) => {
      if (v === undefined) return '<td class="missing"></td>';
      if (Ast.isContainer(v)) return `<td class="nested" title="${esc(Ast.compact(v, 400)).replace(/"/g, '&quot;')}">${esc(Ast.compact(v, 60))}</td>`;
      return `<td class="${leafClass(v)}">${esc(Ast.text(v))}</td>`;
    }).join('');
    return `<tr><td class="rownum">${r + 1}</td>${cells}</tr>`;
  }).join('');
  els.tableView.innerHTML = `<table class="data-table"><thead><tr><th class="rownum">#</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  els.tableInfo.textContent = `${plural(rows.length, 'row')} × ${plural(cols.length, 'column')}` +
    (rows.length > TABLE_LIMIT ? ` · showing the first ${TABLE_LIMIT.toLocaleString()} (download gets all)` : '') +
    ' · click a header to sort';
}

/* ---------- graph view ---------- */

function renderGraph() {
  if (isFresh('graph')) return;
  const ctl = JsonGraph.render(els.graphView, state.ast);
  els.graphInfo.textContent = `${plural(ctl.nodes, 'node')}${ctl.truncated ? ' (first 2,500 shown)' : ''} · drag to move · scroll to zoom · click a row to collapse or expand`;
}

/* ---------- convert view ---------- */

const CONVERTERS = {
  yaml: { ext: 'yaml', mime: 'text/yaml', make: (ast) => JsonConvert.yaml(ast) },
  csv: { ext: 'csv', mime: 'text/csv', make: () => JsonConvert.csv(tableSource().pick.node), bom: true },
  xml: { ext: 'xml', mime: 'application/xml', make: (ast) => JsonConvert.xml(ast) },
  typescript: { ext: 'ts', mime: 'text/plain', make: (ast) => JsonConvert.typescript(ast) },
};

function renderConvert() {
  if (isFresh('convert')) return;
  const format = els.convertFormat.value;
  try {
    state.converted = CONVERTERS[format].make(state.ast);
    els.convertInfo.textContent = format === 'csv'
      ? `Rows from ${state.tablePath} (pick another array in the Table view) · nested objects become dotted columns`
      : `${countLines(state.converted).toLocaleString()} lines`;
  } catch (e) {
    state.converted = '';
    els.convertInfo.textContent = `Could not convert: ${e.message}`;
  }
  els.convertOut.textContent = state.converted;
}

// what Copy and Download act on for the current view
function currentExport() {
  const base = state.baseName;
  if (state.view === 'convert') {
    renderConvert();
    const c = CONVERTERS[els.convertFormat.value];
    return { text: state.converted, name: `${base}.${c.ext}`, mime: c.mime, bom: c.bom };
  }
  if (state.view === 'table') {
    return { text: JsonConvert.csv(tableSource().pick.node), name: `${base}.csv`, mime: 'text/csv', bom: true };
  }
  const suffix = state.query ? '.query' : state.mode === 'minify' ? '.min' : '.formatted';
  return { text: state.mode === 'minify' ? state.output : `${state.output}\n`, name: `${base}${suffix}.json`, mime: 'application/json' };
}

/* ---------- search (CSS Custom Highlight API: no DOM changes) ---------- */

const search = { ranges: [], idx: -1 };
const canHighlight = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
const SEARCH_LIMIT = 10000;

function searchRoot() {
  return { code: els.codeOut, tree: els.treeView, table: els.tableView, convert: els.convertOut }[state.view] || null;
}

function runSearch(keepPlace = false) {
  if (canHighlight) { CSS.highlights.delete('jf-hit'); CSS.highlights.delete('jf-current'); }
  search.ranges = [];
  const term = els.searchInput.value;
  const root = searchRoot();
  if (!term || !state.ast) { els.searchCount.textContent = ''; return; }
  if (!root) { els.searchCount.textContent = 'not in Graph view'; return; }
  if (!canHighlight) { els.searchCount.textContent = 'needs a newer browser'; return; }

  // join all visible text, find matches, then map them back to text-node ranges
  const nodes = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (state.view === 'tree' && n.parentElement?.closest('details:not([open]) > .kids')) continue;
    nodes.push({ n, start: text.length });
    text += n.nodeValue;
  }
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  let ni = 0;
  for (let pos = hay.indexOf(needle); pos !== -1 && search.ranges.length < SEARCH_LIMIT; pos = hay.indexOf(needle, pos + needle.length)) {
    while (ni + 1 < nodes.length && nodes[ni + 1].start <= pos) ni++;
    const end = pos + needle.length;
    let ej = ni;
    while (ej + 1 < nodes.length && nodes[ej + 1].start < end) ej++;
    const r = document.createRange();
    r.setStart(nodes[ni].n, pos - nodes[ni].start);
    r.setEnd(nodes[ej].n, end - nodes[ej].start);
    search.ranges.push(r);
  }
  const hl = new Highlight();
  search.ranges.forEach((r) => hl.add(r));
  CSS.highlights.set('jf-hit', hl);
  if (!keepPlace || search.idx < 0) search.idx = 0;
  search.idx = Math.min(search.idx, search.ranges.length - 1);
  showMatch(!keepPlace);
}

function showMatch(scroll = true) {
  if (canHighlight) CSS.highlights.delete('jf-current');
  const n = search.ranges.length;
  const more = n >= SEARCH_LIMIT ? '+' : '';
  els.searchCount.textContent = n ? `${search.idx + 1} / ${n.toLocaleString()}${more}` : 'no matches';
  if (!n) return;
  const r = search.ranges[search.idx];
  CSS.highlights.set('jf-current', new Highlight(r));
  if (scroll) r.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function stepMatch(dir) {
  const n = search.ranges.length;
  if (!n) { runSearch(); return; }
  search.idx = (search.idx + dir + n) % n;
  showMatch();
}

/* ---------- input ---------- */

let gutterLines = 0;
function updateInGutter() {
  const n = countLines(els.input.value);
  if (n !== gutterLines) {
    gutterLines = n;
    els.inGutter.textContent = lineNumbers(n);
  }
  els.inGutter.scrollTop = els.input.scrollTop;
}

function updateCaret() {
  const ta = els.input;
  const before = ta.value.slice(0, ta.selectionStart);
  const line = countLines(before);
  const col = before.length - before.lastIndexOf('\n');
  const size = ta.value.length ? ` · ${formatBytes(new Blob([ta.value]).size)}` : '';
  els.inStatus.textContent = `Ln ${line}, Col ${col}${size}`;
}

let liveTimer = null;
function onInputChanged(live = true) {
  updateInGutter();
  updateCaret();
  clearTimeout(liveTimer);
  if (!live) return;
  if (els.input.value.length <= LIVE_LIMIT) liveTimer = setTimeout(run, 300);
  else els.outStatus.textContent = 'Large input: press Format or Ctrl+Enter';
}

function selectInput(pos) {
  if (isFullscreen()) toggleFullscreen();
  const ta = els.input;
  const p = Math.max(0, Math.min(pos, ta.value.length));
  ta.focus();
  ta.setSelectionRange(p, Math.min(p + 1, ta.value.length));
  const line = countLines(ta.value.slice(0, p));
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2);
  updateInGutter();
  updateCaret();
}

function loadFile(file) {
  if (!file) return;
  if (file.size > 100 * 1024 * 1024 && !confirm(`${file.name} is ${formatBytes(file.size)}. Loading it may be slow. Continue?`)) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.baseName = file.name.replace(/\.(json|txt|log)$/i, '') || 'data';
    els.input.value = String(reader.result);
    els.input.scrollTop = 0;
    onInputChanged(false);
    run();
    toast(`Loaded ${file.name}`);
  };
  reader.onerror = () => toast(`Could not read ${file.name}`);
  reader.readAsText(file);
}

/* ---------- output actions ---------- */

function download() {
  if (!state.output) return;
  const exp = currentExport();
  // the BOM lets Excel open UTF-8 CSV correctly
  const blob = new Blob([exp.bom ? '﻿' : '', exp.text], { type: exp.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exp.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloaded ${a.download}`);
}

async function copyText(text, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    (document.fullscreenElement || document.body).append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label);
}

const isFullscreen = () => document.fullscreenElement === els.outputPanel || els.outputPanel.classList.contains('fs-fallback');

function toggleFullscreen() {
  const panel = els.outputPanel;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (panel.classList.contains('fs-fallback')) {
    panel.classList.remove('fs-fallback');
    updateFsButton();
  } else if (panel.requestFullscreen) {
    panel.requestFullscreen().catch(() => { panel.classList.add('fs-fallback'); updateFsButton(); });
  } else {
    panel.classList.add('fs-fallback');
    updateFsButton();
  }
}

function updateFsButton() {
  els.fsBtn.textContent = isFullscreen() ? 'Exit full screen' : 'Full screen';
}

function applyFontSize() {
  els.outputPanel.style.setProperty('--code-size', `${state.fontSize}px`);
  store.set('jf.fontSize', String(state.fontSize));
}

let toastTimer = null;
function toast(message) {
  const t = els.toast;
  (document.fullscreenElement || document.body).append(t);
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function setMode(mode) {
  state.mode = mode;
  els.prettyBtn.classList.toggle('active', mode === 'pretty');
  els.minifyBtn.classList.toggle('active', mode === 'minify');
  run();
}

/* ---------- theme ---------- */

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/* ---------- wiring ---------- */

els.input.addEventListener('input', () => onInputChanged());
els.input.addEventListener('scroll', () => { els.inGutter.scrollTop = els.input.scrollTop; });
['keyup', 'click', 'select'].forEach((ev) => els.input.addEventListener(ev, updateCaret));
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    els.input.setRangeText('  ', els.input.selectionStart, els.input.selectionEnd, 'end');
    onInputChanged();
  }
});

$('openBtn').addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => { loadFile(els.fileInput.files[0]); els.fileInput.value = ''; });
$('sampleBtn').addEventListener('click', () => {
  state.baseName = 'sample';
  els.input.value = SAMPLE;
  els.autoFix.checked = true;
  onInputChanged(false);
  run();
});
$('clearBtn').addEventListener('click', () => {
  els.input.value = '';
  state.baseName = 'data';
  onInputChanged(false);
  run();
  els.input.focus();
});

let dragDepth = 0;
els.inputPanel.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; els.inputPanel.classList.add('dragging'); });
els.inputPanel.addEventListener('dragover', (e) => e.preventDefault());
els.inputPanel.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.inputPanel.classList.remove('dragging'); } });
els.inputPanel.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.inputPanel.classList.remove('dragging');
  loadFile(e.dataTransfer.files[0]);
});

els.prettyBtn.addEventListener('click', () => setMode('pretty'));
els.minifyBtn.addEventListener('click', () => setMode('minify'));
els.indentSel.addEventListener('change', () => { store.set('jf.indent', els.indentSel.value); setMode('pretty'); });
els.autoFix.addEventListener('change', run);
els.sortKeys.addEventListener('change', run);

document.querySelectorAll('#viewSeg [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('expandBtn').addEventListener('click', () => { expandAll(); runSearch(true); });
$('collapseBtn').addEventListener('click', () => { collapseAll(); runSearch(true); });
$('zoomIn').addEventListener('click', () => { state.fontSize = Math.min(28, state.fontSize + 1); applyFontSize(); });
$('zoomOut').addEventListener('click', () => { state.fontSize = Math.max(9, state.fontSize - 1); applyFontSize(); });
els.copyBtn.addEventListener('click', () => { if (state.output) copyText(currentExport().text); });

let searchTimer = null;
els.searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(), 150); });
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { els.searchInput.value = ''; runSearch(); }
});
$('searchNext').addEventListener('click', () => stepMatch(1));
$('searchPrev').addEventListener('click', () => stepMatch(-1));

els.queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runQuery(); } });
$('queryRun').addEventListener('click', runQuery);
$('queryClear').addEventListener('click', () => { els.queryInput.value = ''; runQuery(); });
els.queryMode.addEventListener('change', () => { if (state.query) run(); });

els.tableSource.addEventListener('change', () => {
  state.tablePath = els.tableSource.value;
  state.tableSort = { col: -1, dir: 1 };
  state.rendered.table = -1;
  state.rendered.convert = -1;
  renderTable();
  runSearch(true);
});
els.tableView.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-col]');
  if (!th) return;
  const col = Number(th.dataset.col);
  const sort = state.tableSort;
  state.tableSort = { col, dir: sort.col === col ? -sort.dir : 1 };
  state.rendered.table = -1;
  renderTable();
  runSearch(true);
});
$('graphFit').addEventListener('click', () => els.graphView.graph?.fit());
$('graphZoomIn').addEventListener('click', () => els.graphView.graph?.zoom(1.25));
$('graphZoomOut').addEventListener('click', () => els.graphView.graph?.zoom(0.8));
els.convertFormat.addEventListener('change', () => {
  store.set('jf.convert', els.convertFormat.value);
  state.rendered.convert = -1;
  renderConvert();
  runSearch(true);
});
els.downloadBtn.addEventListener('click', download);
els.fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFsButton);

els.treeView.addEventListener('click', (e) => {
  const node = e.target.closest('[data-path]');
  if (!node) return;
  els.treeView.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
  node.classList.add('selected');
  els.outStatus.innerHTML = `Path: <code>${esc(node.dataset.path)}</code> · double-click to copy`;
});
els.treeView.addEventListener('dblclick', (e) => {
  const node = e.target.closest('[data-path]');
  if (node) copyText(node.dataset.path, `Copied ${node.dataset.path}`);
});

$('themeBtn').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store.set('jf.theme', next);
});

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.view !== 'json') return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && e.key === 'Enter') { e.preventDefault(); setMode('pretty'); }
  else if (mod && !e.shiftKey && key === 'f') { e.preventDefault(); els.searchInput.focus(); els.searchInput.select(); }
  else if (mod && e.shiftKey && key === 'f') { e.preventDefault(); toggleFullscreen(); }
  else if (mod && !e.shiftKey && key === 's') { e.preventDefault(); download(); }
  else if (e.key === 'Escape' && els.outputPanel.classList.contains('fs-fallback')) toggleFullscreen();
});

// initial state
applyTheme(store.get('jf.theme'));
const savedIndent = store.get('jf.indent');
if (savedIndent && [...els.indentSel.options].some((o) => o.value === savedIndent)) els.indentSel.value = savedIndent;
const savedConvert = store.get('jf.convert');
if (savedConvert && CONVERTERS[savedConvert]) els.convertFormat.value = savedConvert;
applyFontSize();
setOutput(null);
updateInGutter();
updateCaret();
