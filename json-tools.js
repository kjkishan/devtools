'use strict';

/* ================================================================
   JSON tools on the lenient-parser AST (see app.js):
   JSONPath query, table rows, converters (YAML / CSV / XML / TS),
   structural + line diff, and the graph view.
   Uses stringify(), childPath(), leafClass() and esc() from app.js at call time.
   ================================================================ */

const Ast = {
  isContainer: (n) => n.t === 'o' || n.t === 'a',
  size: (n) => (n.t === 'o' ? n.entries.length : n.t === 'a' ? n.items.length : 0),
  key(e) {
    try { return JSON.parse(e.k); } catch { return e.k; }
  },
  prim(n) {
    if (n.t === 's') { try { return JSON.parse(n.raw); } catch { return n.raw; } }
    if (n.t === 'n') return Number(n.raw);
    if (n.t === 'l') return n.raw === 'null' ? null : n.raw === 'true';
    return undefined;
  },
  // text for display: strings without quotes, everything else as written
  text(n) {
    return n.t === 's' ? String(Ast.prim(n)) : n.raw;
  },
  compact(n, max = 80) {
    const s = stringify(n, '', false);
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  },
  children(n) {
    if (n.t === 'o') return n.entries.map((e) => [Ast.key(e), e.v]);
    if (n.t === 'a') return n.items.map((v, i) => [i, v]);
    return [];
  },
};

/* ---------------- JSONPath ---------------- */

const JsonPath = (() => {
  const truthy = (v) => v !== undefined && v !== null && v !== false;

  function unquote(lit) {
    if (lit[0] === '"') return JSON.parse(lit);
    return lit.slice(1, -1).replace(/\\(['\\])/g, '$1');
  }

  // returns [content, indexAfterClosingBracket]; s[i] must be '['
  function readBracket(s, i) {
    let depth = 0;
    let quote = null;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '[' || c === '(') depth++;
      else if (c === ']' || c === ')') {
        depth--;
        if (depth === 0 && c === ']') return [s.slice(i + 1, j), j + 1];
      }
    }
    throw new Error('Missing closing ]');
  }

  function splitTop(s, sep) {
    const parts = [];
    let quote = null;
    let depth = 0;
    let start = 0;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === sep && depth === 0) { parts.push(s.slice(start, j)); start = j + 1; }
    }
    parts.push(s.slice(start));
    return parts;
  }

  /* ---- filter expressions: ?( @.price < 10 && @.tags.length > 0 ) ---- */

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      const c = src[i];
      let m;
      if (/\s/.test(c)) { i++; continue; }
      if ((m = /^(===|!==|==|!=|<=|>=|=~|<|>)/.exec(rest))) {
        toks.push({ type: 'op', v: m[1] });
        i += m[1].length;
        if (m[1] === '=~') {
          while (/\s/.test(src[i] || '')) i++;
          const rm = /^\/((?:\\.|[^/\\])+)\/([imsu]*)/.exec(src.slice(i));
          if (!rm) throw new Error('=~ needs a /regex/');
          toks.push({ type: 'regex', v: rm[0], re: new RegExp(rm[1], rm[2]) });
          i += rm[0].length;
        }
        continue;
      }
      if (rest.startsWith('&&') || rest.startsWith('||')) { toks.push({ type: 'logic', v: rest.slice(0, 2) }); i += 2; continue; }
      if ('@$.[]()!'.includes(c)) { toks.push({ type: 'punct', v: c }); i++; continue; }
      if ((m = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(rest))) { toks.push({ type: 'num', v: m[0], n: Number(m[0]) }); i += m[0].length; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        if (j >= src.length) throw new Error('Unclosed string in filter');
        const lit = src.slice(i, j + 1);
        toks.push({ type: 'str', v: lit, s: unquote(lit) });
        i = j + 1;
        continue;
      }
      if ((m = /^[A-Za-z_][\w$-]*/.exec(rest))) { toks.push({ type: 'id', v: m[0] }); i += m[0].length; continue; }
      throw new Error(`Unexpected "${c}" in filter`);
    }
    return toks;
  }

  function resolve(node, steps) {
    let cur = node;
    for (const st of steps) {
      if (cur === undefined) return undefined;
      if (st.name === 'length' && (cur.t === 'a' || cur.t === 's')) {
        return cur.t === 'a' ? cur.items.length : String(Ast.prim(cur)).length;
      }
      if (cur.t === 'o') {
        const e = cur.entries.find((en) => Ast.key(en) === String(st.name ?? st.index));
        cur = e ? e.v : undefined;
      } else if (cur.t === 'a' && st.index !== undefined) {
        cur = cur.items[st.index < 0 ? cur.items.length + st.index : st.index];
      } else {
        return undefined;
      }
    }
    if (cur === undefined) return undefined;
    return Ast.isContainer(cur) ? cur : Ast.prim(cur);
  }

  function compare(op, a, b) {
    switch (op) {
      case '==': case '===': return a === b;
      case '!=': case '!==': return a !== b;
      case '<': return a != null && b != null && a < b;
      case '<=': return a != null && b != null && a <= b;
      case '>': return a != null && b != null && a > b;
      case '>=': return a != null && b != null && a >= b;
      default: return false;
    }
  }

  function compileFilter(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = (v) => {
      if (!toks[p] || toks[p].v !== v) throw new Error(`Expected "${v}" in filter`);
      p++;
    };

    function parseSteps() {
      const steps = [];
      for (;;) {
        const t = peek();
        if (t?.v === '.') {
          next();
          const n = next();
          if (!n || (n.type !== 'id' && n.type !== 'num')) throw new Error('Expected a name after "."');
          steps.push(n.type === 'num' ? { index: n.n } : { name: n.v });
        } else if (t?.v === '[') {
          next();
          const k = next();
          if (!k) throw new Error('Unclosed [ in filter');
          expect(']');
          steps.push(k.type === 'num' ? { index: k.n } : { name: k.s ?? k.v });
        } else {
          return steps;
        }
      }
    }

    function parseVal() {
      const t = next();
      if (!t) throw new Error('Filter ended too early');
      if (t.v === '(') { const e = parseOr(); expect(')'); return e; }
      if (t.type === 'num') return () => t.n;
      if (t.type === 'str') return () => t.s;
      if (t.type === 'id') {
        if (t.v === 'true') return () => true;
        if (t.v === 'false') return () => false;
        if (t.v === 'null') return () => null;
        throw new Error(`Unknown word "${t.v}" in filter`);
      }
      if (t.v === '@' || t.v === '$') {
        const steps = parseSteps();
        const fromRoot = t.v === '$';
        return (ctx) => resolve(fromRoot ? ctx.root : ctx.cur, steps);
      }
      throw new Error(`Unexpected "${t.v}" in filter`);
    }

    function parseCmp() {
      const left = parseVal();
      const t = peek();
      if (!t || t.type !== 'op') return left;
      next();
      if (t.v === '=~') {
        const re = next().re;
        return (ctx) => {
          const v = left(ctx);
          return typeof v === 'string' && re.test(v);
        };
      }
      const right = parseVal();
      return (ctx) => compare(t.v, left(ctx), right(ctx));
    }

    function parseNot() {
      if (peek()?.v === '!') {
        next();
        const f = parseNot();
        return (ctx) => !truthy(f(ctx));
      }
      return parseCmp();
    }

    function parseAnd() {
      let l = parseNot();
      while (peek()?.v === '&&') {
        next();
        const a = l;
        const r = parseNot();
        l = (ctx) => truthy(a(ctx)) && truthy(r(ctx));
      }
      return l;
    }

    function parseOr() {
      let l = parseAnd();
      while (peek()?.v === '||') {
        next();
        const a = l;
        const r = parseAnd();
        l = (ctx) => truthy(a(ctx)) || truthy(r(ctx));
      }
      return l;
    }

    const fn = parseOr();
    if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}" in filter`);
    return fn;
  }

  function parseBracket(content) {
    const t = content.trim();
    if (t === '*') return [{ type: 'wild' }];
    if (t.startsWith('?')) {
      let e = t.slice(1).trim();
      if (e.startsWith('(') && e.endsWith(')')) e = e.slice(1, -1);
      return [{ type: 'filter', fn: compileFilter(e) }];
    }
    return splitTop(t, ',').map((part) => {
      const p = part.trim();
      if (/^["']/.test(p)) return { type: 'name', v: unquote(p) };
      if (/^-?\d*:-?\d*(?::-?\d+)?$/.test(p)) {
        const [a, b, c] = p.split(':');
        return { type: 'slice', start: a === '' ? null : Number(a), end: b === '' ? null : Number(b), step: c ? Number(c) : 1 };
      }
      if (/^-?\d+$/.test(p)) return { type: 'index', v: Number(p) };
      if (p === '*') return { type: 'wild' };
      if (/^[\w$-]+$/.test(p)) return { type: 'name', v: p };
      throw new Error(`Unsupported selector [${p}]`);
    });
  }

  function parse(expr) {
    let s = expr.trim();
    if (!s) throw new Error('Type a query, e.g. $.items[*].name');
    if (s[0] !== '$') s = (s[0] === '.' || s[0] === '[' ? '$' : '$.') + s;
    const segs = [];
    let i = 1;
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }
      let recursive = false;
      if (s.startsWith('..', i)) { recursive = true; i += 2; }
      else if (s[i] === '.') i++;
      else if (s[i] !== '[') throw new Error(`Unexpected "${s[i]}" at position ${i + 1}`);

      let sels;
      if (s[i] === '[') {
        const [content, after] = readBracket(s, i);
        sels = parseBracket(content);
        i = after;
      } else {
        const m = /^(\*|[^.[\]\s()]+)/.exec(s.slice(i));
        if (!m) throw new Error(`Expected a key name at position ${i + 1}`);
        sels = [m[1] === '*' ? { type: 'wild' } : { type: 'name', v: m[1] }];
        i += m[1].length;
      }
      segs.push({ recursive, sels });
    }
    return segs;
  }

  function sliceIndexes(len, start, end, step) {
    const out = [];
    if (!step) return out;
    if (step > 0) {
      const s = start == null ? 0 : start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
      const e = end == null ? len : end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
      for (let k = s; k < e; k += step) out.push(k);
    } else {
      const s = start == null ? len - 1 : start < 0 ? len + start : Math.min(start, len - 1);
      const e = end == null ? -1 : end < 0 ? len + end : end;
      for (let k = s; k > e; k += step) if (k >= 0 && k < len) out.push(k);
    }
    return out;
  }

  function descend(item) {
    const out = [];
    const stack = [item];
    while (stack.length) {
      const cur = stack.pop();
      out.push(cur);
      const kids = Ast.children(cur.node);
      for (let k = kids.length - 1; k >= 0; k--) {
        const [key, v] = kids[k];
        if (Ast.isContainer(v)) stack.push({ node: v, path: step(cur.path, key) });
      }
    }
    return out;
  }

  const step = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : childPath(path, key));

  function select(sel, item, root, out) {
    const n = item.node;
    switch (sel.type) {
      case 'name':
        if (n.t === 'o') {
          const e = n.entries.find((en) => Ast.key(en) === sel.v);
          if (e) out.push({ node: e.v, path: step(item.path, sel.v) });
        }
        break;
      case 'index':
        if (n.t === 'a') {
          const k = sel.v < 0 ? n.items.length + sel.v : sel.v;
          if (k >= 0 && k < n.items.length) out.push({ node: n.items[k], path: step(item.path, k) });
        }
        break;
      case 'slice':
        if (n.t === 'a') {
          for (const k of sliceIndexes(n.items.length, sel.start, sel.end, sel.step)) out.push({ node: n.items[k], path: step(item.path, k) });
        }
        break;
      case 'wild':
        for (const [k, v] of Ast.children(n)) out.push({ node: v, path: step(item.path, k) });
        break;
      case 'filter':
        for (const [k, v] of Ast.children(n)) {
          if (truthy(sel.fn({ cur: v, root }))) out.push({ node: v, path: step(item.path, k) });
        }
        break;
      default:
        break;
    }
  }

  function query(root, expr) {
    const segs = parse(expr);
    let cur = [{ node: root, path: '$' }];
    for (const seg of segs) {
      const next = [];
      for (const item of cur) {
        const targets = seg.recursive ? descend(item) : [item];
        for (const t of targets) for (const sel of seg.sels) select(sel, t, root, next);
      }
      cur = next;
      if (cur.length > 500000) throw new Error('Query matches too much data (over 500,000 results)');
    }
    return cur;
  }

  return { query, parse };
})();

/* ---------------- table rows ---------------- */

const JsonTable = {
  // arrays that hold mostly objects, shallowest first
  sources(root) {
    const out = [];
    const queue = [{ node: root, path: '$', depth: 0 }];
    for (let q = 0; q < queue.length && q < 20000 && out.length < 40; q++) {
      const { node, path, depth } = queue[q];
      if (node.t === 'a' && node.items.length) {
        const objs = node.items.reduce((c, v) => c + (v.t === 'o' ? 1 : 0), 0);
        if (objs && objs >= node.items.length / 2) out.push({ path, node });
      }
      if (depth >= 6) continue;
      for (const [k, v] of Ast.children(node)) {
        if (Ast.isContainer(v)) queue.push({ node: v, path: typeof k === 'number' ? `${path}[${k}]` : childPath(path, k), depth: depth + 1 });
      }
    }
    if (!out.length) out.push({ path: '$', node: root });
    return out;
  },

  build(node) {
    const items = node.t === 'a' ? node.items : [node];
    const cols = [];
    const seen = new Set();
    let hasValue = false;
    const rows = items.map((it) => {
      if (it.t !== 'o') { hasValue = true; return { value: it, cells: null }; }
      const cells = new Map();
      for (const e of it.entries) {
        const k = Ast.key(e);
        cells.set(k, e.v);
        if (!seen.has(k)) { seen.add(k); cols.push(k); }
      }
      return { value: null, cells };
    });
    if (hasValue) cols.unshift('(value)');
    return {
      cols,
      rows: rows.map((r) => cols.map((c) => (c === '(value)' ? r.value ?? undefined : r.cells ? r.cells.get(c) : undefined))),
    };
  },
};

/* ---------------- converters ---------------- */

const JsonConvert = {
  yaml(root) {
    const plain = (s) => !(
      s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /: | #|[\n\r\t]|\s$|:$/.test(s) ||
      /^(true|false|null|yes|no|on|off|y|n|~)$/i.test(s) || /^[-+]?(\d|\.\d)/.test(s)
    );
    const str = (s) => (plain(s) ? s : JSON.stringify(s));
    const scalar = (n) => (n.t === 's' ? str(String(Ast.prim(n))) : n.raw);
    const empty = (n) => (n.t === 'o' ? '{}' : '[]');

    function block(n, ind) {
      const pad = ' '.repeat(ind);
      const out = [];
      if (n.t === 'o') {
        for (const e of n.entries) {
          const k = str(String(Ast.key(e)));
          const v = e.v;
          if (!Ast.isContainer(v)) out.push(`${pad}${k}: ${scalar(v)}`);
          else if (!Ast.size(v)) out.push(`${pad}${k}: ${empty(v)}`);
          else { out.push(`${pad}${k}:`); out.push(...block(v, ind + 2)); }
        }
      } else {
        for (const v of n.items) {
          if (!Ast.isContainer(v)) out.push(`${pad}- ${scalar(v)}`);
          else if (!Ast.size(v)) out.push(`${pad}- ${empty(v)}`);
          else {
            const inner = block(v, ind + 2);
            inner[0] = `${pad}- ${inner[0].slice(ind + 2)}`;
            out.push(...inner);
          }
        }
      }
      return out;
    }

    if (!Ast.isContainer(root)) return `${scalar(root)}\n`;
    if (!Ast.size(root)) return `${empty(root)}\n`;
    return `${block(root, 0).join('\n')}\n`;
  },

  csv(node) {
    const items = node.t === 'a' ? node.items : [node];
    const cols = [];
    const seen = new Set();
    const flat = items.map((it) => {
      const row = new Map();
      if (it.t !== 'o') row.set('value', Ast.isContainer(it) ? stringify(it, '', false) : Ast.text(it));
      else (function walk(o, prefix) {
        for (const e of o.entries) {
          const k = prefix ? `${prefix}.${Ast.key(e)}` : String(Ast.key(e));
          const v = e.v;
          if (v.t === 'o' && v.entries.length) walk(v, k);
          else if (v.t === 'a' && v.items.every((x) => !Ast.isContainer(x))) row.set(k, v.items.map(Ast.text).join('; '));
          else if (Ast.isContainer(v)) row.set(k, stringify(v, '', false));
          else row.set(k, v.t === 'l' && v.raw === 'null' ? '' : Ast.text(v));
        }
      })(it, '');
      for (const k of row.keys()) if (!seen.has(k)) { seen.add(k); cols.push(k); }
      return row;
    });
    const cell = (s) => (/[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [cols.map(cell).join(',')];
    for (const row of flat) lines.push(cols.map((c) => cell(row.get(c) ?? '')).join(','));
    return `${lines.join('\n')}\n`;
  },

  xml(root) {
    const tag = (k) => {
      let s = String(k).replace(/[^\w.-]/g, '_');
      if (!/^[A-Za-z_]/.test(s) || /^xml/i.test(s)) s = `_${s}`;
      return s;
    };
    const text = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
    (function el(name, n, ind) {
      const pad = '  '.repeat(ind);
      if (Ast.isContainer(n)) {
        if (!Ast.size(n)) { lines.push(`${pad}<${name}/>`); return; }
        lines.push(`${pad}<${name}>`);
        if (n.t === 'o') for (const e of n.entries) el(tag(Ast.key(e)), e.v, ind + 1);
        else for (const v of n.items) el('item', v, ind + 1);
        lines.push(`${pad}</${name}>`);
      } else if (n.t === 'l' && n.raw === 'null') {
        lines.push(`${pad}<${name}/>`);
      } else {
        lines.push(`${pad}<${name}>${text(Ast.text(n))}</${name}>`);
      }
    })('root', root, 0);
    return `${lines.join('\n')}\n`;
  },

  typescript(root) {
    const interfaces = [];
    const used = new Set();
    const pascal = (s) => {
      const p = String(s).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
      return (/^\d/.test(p) ? `_${p}` : p) || 'Item';
    };
    const singular = (s) => {
      const t = String(s);
      if (/ies$/i.test(t)) return t.replace(/ies$/i, 'y');
      if (t.length > 3 && /s$/i.test(t) && !/(ss|us|is)$/i.test(t)) return t.slice(0, -1);
      return `${t}Item`;
    };
    const unique = (base) => {
      let n = base;
      for (let k = 2; used.has(n); k++) n = `${base}${k}`;
      used.add(n);
      return n;
    };

    function objectType(objs, hint) {
      const name = unique(pascal(hint));
      const keys = new Map();
      for (const o of objs) {
        for (const e of o.entries) {
          const k = String(Ast.key(e));
          if (!keys.has(k)) keys.set(k, { nodes: [], count: 0 });
          const r = keys.get(k);
          r.nodes.push(e.v);
          r.count++;
        }
      }
      const slot = interfaces.length;
      interfaces.push('');
      const lines = [];
      for (const [k, r] of keys) {
        const prop = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
        lines.push(`  ${prop}${r.count < objs.length ? '?' : ''}: ${typeOf(r.nodes, k)};`);
      }
      interfaces[slot] = `export interface ${name} {\n${lines.join('\n')}\n}`;
      return name;
    }

    function typeOf(nodes, hint) {
      const parts = new Set();
      const objs = [];
      const arrs = [];
      for (const n of nodes) {
        if (n.t === 's') parts.add('string');
        else if (n.t === 'n') parts.add('number');
        else if (n.t === 'l') parts.add(n.raw === 'null' ? 'null' : 'boolean');
        else if (n.t === 'o') objs.push(n);
        else arrs.push(n);
      }
      if (objs.length) parts.add(objectType(objs, hint));
      if (arrs.length) {
        const items = arrs.flatMap((a) => a.items);
        const inner = items.length ? typeOf(items, singular(hint)) : 'unknown';
        parts.add(inner.includes(' | ') ? `(${inner})[]` : `${inner}[]`);
      }
      return [...parts].join(' | ') || 'unknown';
    }

    const t = typeOf([root], 'Root');
    const alias = root.t === 'o' ? '' : `export type RootData = ${t};\n\n`;
    return `${alias}${interfaces.join('\n\n')}\n`;
  },
};

/* ---------------- diff ---------------- */

const JsonDiff = {
  // key-based structural diff; arrays are compared by position
  structural(a, b, path = '$', out = [], limit = 5000) {
    if (out.length >= limit) return out;
    if (a.t === 'o' && b.t === 'o') {
      const am = new Map(a.entries.map((e) => [Ast.key(e), e.v]));
      const bm = new Map(b.entries.map((e) => [Ast.key(e), e.v]));
      for (const [k, v] of am) {
        const p = childPath(path, k);
        if (!bm.has(k)) out.push({ kind: 'removed', path: p, a: v });
        else JsonDiff.structural(v, bm.get(k), p, out, limit);
      }
      for (const [k, v] of bm) if (!am.has(k)) out.push({ kind: 'added', path: childPath(path, k), b: v });
    } else if (a.t === 'a' && b.t === 'a') {
      const n = Math.max(a.items.length, b.items.length);
      for (let i = 0; i < n && out.length < limit; i++) {
        const p = `${path}[${i}]`;
        if (i >= a.items.length) out.push({ kind: 'added', path: p, b: b.items[i] });
        else if (i >= b.items.length) out.push({ kind: 'removed', path: p, a: a.items[i] });
        else JsonDiff.structural(a.items[i], b.items[i], p, out, limit);
      }
    } else if (!JsonDiff.sameLeaf(a, b)) {
      out.push({ kind: 'changed', path, a, b });
    }
    return out;
  },

  sameLeaf(a, b) {
    if (a.t !== b.t) return false;
    if (a.t === 'n') return Number(a.raw) === Number(b.raw);
    if (a.t === 's') return Ast.prim(a) === Ast.prim(b);
    return a.raw === b.raw;
  },

  // Myers line diff -> [{type:'eq'|'del'|'ins', a, b}]
  lines(a, b, maxD = 4000) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const A = a.slice(pre, a.length - suf);
    const B = b.slice(pre, b.length - suf);
    const ops = [];
    for (let k = 0; k < pre; k++) ops.push({ type: 'eq', a: k, b: k });
    const mid = JsonDiff.myers(A, B, maxD);
    if (mid) {
      for (const o of mid) ops.push({ type: o.type, a: o.a === undefined ? undefined : o.a + pre, b: o.b === undefined ? undefined : o.b + pre });
    } else {
      for (let k = 0; k < A.length; k++) ops.push({ type: 'del', a: k + pre });
      for (let k = 0; k < B.length; k++) ops.push({ type: 'ins', b: k + pre });
    }
    for (let k = 0; k < suf; k++) ops.push({ type: 'eq', a: a.length - suf + k, b: b.length - suf + k });
    return ops;
  },

  myers(a, b, maxD) {
    const n = a.length;
    const m = b.length;
    if (!n && !m) return [];
    const max = n + m;
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    outer:
    for (let d = 0; d <= max; d++) {
      if (d > maxD) return null;
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) { found = d; break outer; }
      }
    }
    const ops = [];
    let x = n;
    let y = m;
    for (let d = found; d >= 0; d--) {
      const vd = trace[d];
      const get = (k) => vd[k + d + 1];
      const k = x - y;
      const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
      const prevX = get(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push({ type: 'eq', a: x - 1, b: y - 1 }); x--; y--; }
      if (d > 0) {
        if (x === prevX) ops.push({ type: 'ins', b: y - 1 });
        else ops.push({ type: 'del', a: x - 1 });
      }
      x = prevX;
      y = prevY;
    }
    return ops.reverse();
  },
};

/* ---------------- graph view ---------------- */

const JsonGraph = (() => {
  const CHAR = 7.3;
  const ROW = 20;
  const PADX = 10;
  const PADY = 6;
  const GAPX = 64;
  const GAPY = 14;
  const MINW = 110;
  const MAXW = 340;
  const MAXROWS = 60;
  const MAXNODES = 2500;
  const MAXCHARS = Math.floor((MAXW - 2 * PADX) / CHAR);

  function build(ast, collapsed) {
    const nodes = [];
    let truncated = false;

    function make(n, path, depth) {
      if (nodes.length >= MAXNODES) { truncated = true; return null; }
      const g = { id: nodes.length, path, depth, rows: [], kids: [], arr: n.t === 'a' };
      nodes.push(g);
      if (!Ast.isContainer(n)) {
        g.rows.push({ key: null, val: Ast.text(n), cls: leafClass(n) });
      } else {
        const list = Ast.children(n);
        for (const [k, v] of list.slice(0, MAXROWS)) {
          const row = { key: String(k), idx: n.t === 'a' };
          const cp = typeof k === 'number' ? `${path}[${k}]` : childPath(path, k);
          if (Ast.isContainer(v)) {
            const cnt = Ast.size(v);
            row.val = v.t === 'o' ? `{${cnt}}` : `[${cnt}]`;
            row.cls = 'meta';
            if (cnt) {
              row.toggle = cp;
              if (collapsed.has(cp)) row.collapsed = true;
              else {
                const child = make(v, cp, depth + 1);
                if (child) { row.child = child.id; g.kids.push(child.id); }
              }
            }
          } else {
            row.val = Ast.text(v);
            row.cls = leafClass(v);
          }
          g.rows.push(row);
        }
        if (!list.length) g.rows.push({ key: null, val: n.t === 'o' ? '{ }' : '[ ]', cls: 'meta' });
        if (list.length > MAXROWS) g.rows.push({ key: null, val: `… ${list.length - MAXROWS} more`, cls: 'meta' });
      }
      for (const r of g.rows) {
        const keyLen = r.key == null ? 0 : r.key.length + 2;
        const room = Math.max(4, MAXCHARS - keyLen);
        if (r.val.length > room) r.val = `${r.val.slice(0, room - 1)}…`;
        r.len = keyLen + r.val.length;
      }
      g.w = Math.min(MAXW, Math.max(MINW, Math.max(...g.rows.map((r) => r.len)) * CHAR + 2 * PADX + 8));
      g.h = g.rows.length * ROW + 2 * PADY;
      return g;
    }

    make(ast, '$', 0);
    return { nodes, truncated };
  }

  function layout(nodes) {
    const colW = [];
    for (const g of nodes) colW[g.depth] = Math.max(colW[g.depth] || 0, g.w);
    const colX = [0];
    for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAPX;
    const colBottom = new Array(colW.length).fill(0);
    let cursor = 0;

    const shift = (g, dy) => {
      g.y += dy;
      for (const k of g.kids) shift(nodes[k], dy);
    };
    const settle = (g) => {
      colBottom[g.depth] = Math.max(colBottom[g.depth], g.y + g.h + GAPY);
      for (const k of g.kids) settle(nodes[k]);
    };

    (function place(g) {
      if (!g.kids.length) {
        g.y = Math.max(cursor, colBottom[g.depth]);
        cursor = g.y + g.h + GAPY;
        colBottom[g.depth] = cursor;
        return;
      }
      for (const k of g.kids) place(nodes[k]);
      const first = nodes[g.kids[0]];
      const last = nodes[g.kids[g.kids.length - 1]];
      g.y = (first.y + last.y + last.h) / 2 - g.h / 2;
      if (g.y < colBottom[g.depth]) {
        shift(g, colBottom[g.depth] - g.y);
        settle(g);
      }
      colBottom[g.depth] = Math.max(colBottom[g.depth], g.y + g.h + GAPY);
      cursor = Math.max(cursor, g.y + g.h + GAPY, ...g.kids.map((k) => nodes[k].y + nodes[k].h + GAPY));
    })(nodes[0]);

    const minY = Math.min(...nodes.map((g) => g.y));
    for (const g of nodes) { g.y -= minY; g.x = colX[g.depth]; }
    return {
      width: colX[colX.length - 1] + colW[colW.length - 1],
      height: Math.max(...nodes.map((g) => g.y + g.h)),
    };
  }

  function svgMarkup(nodes) {
    const edges = [];
    const boxes = [];
    for (const g of nodes) {
      const rows = g.rows.map((r, i) => {
        const y = PADY + i * ROW;
        const ty = y + ROW / 2 + 4;
        const keyPart = r.key == null ? '' : `<tspan class="${r.idx ? 'idx' : 'k'}">${esc(r.key)}</tspan><tspan class="p">: </tspan>`;
        let extra = '';
        if (r.toggle) {
          extra += `<rect class="ghit" data-toggle="${esc(r.toggle).replace(/"/g, '&quot;')}" x="1" y="${y}" width="${g.w - 2}" height="${ROW}"/>`;
          extra += `<text class="gtoggle" x="${g.w - 8}" y="${ty}" text-anchor="end">${r.collapsed ? '+' : '−'}</text>`;
        }
        if (r.child !== undefined) {
          const c = nodes[r.child];
          const x1 = g.x + g.w;
          const y1 = g.y + y + ROW / 2;
          const x2 = c.x;
          const y2 = c.y + c.h / 2;
          edges.push(`<path class="gedge" d="M${x1},${y1} C${x1 + GAPX / 2},${y1} ${x2 - GAPX / 2},${y2} ${x2},${y2}"/>`);
          extra += `<circle class="gport" cx="${g.w}" cy="${y + ROW / 2}" r="3"/>`;
        }
        return `${extra}<text class="grow" x="${PADX}" y="${ty}">${keyPart}<tspan class="${r.cls}">${esc(r.val)}</tspan></text>`;
      }).join('');
      boxes.push(`<g class="gnode${g.arr ? ' garr' : ''}" transform="translate(${g.x},${g.y})"><title>${esc(g.path)}</title><rect class="gbox" width="${g.w}" height="${g.h}" rx="7"/>${rows}</g>`);
    }
    return `${edges.join('')}${boxes.join('')}`;
  }

  // renders into container; returns a controller for fit / zoom
  function render(container, ast, collapsed = new Set(), keepView = null) {
    const { nodes, truncated } = build(ast, collapsed);
    const size = layout(nodes);
    container.innerHTML = `<svg class="graph-svg" xmlns="http://www.w3.org/2000/svg"><g class="viewport">${svgMarkup(nodes)}</g></svg>`;
    const svg = container.firstChild;
    const vp = svg.firstChild;
    const view = keepView || { x: 20, y: 20, k: 1 };
    const apply = () => vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);

    // readable=true: never shrink text below 70%; start at the root instead of showing everything tiny
    const fit = (readable = false) => {
      const cw = container.clientWidth || 800;
      const ch = container.clientHeight || 500;
      const k = Math.min(1, (cw - 40) / size.width, (ch - 40) / size.height);
      if (readable && k < 0.7) {
        const root = nodes[0];
        view.k = 0.8;
        view.x = 24;
        view.y = ch / 2 - (root.y + root.h / 2) * view.k;
      } else {
        view.k = Math.max(0.1, k);
        view.x = (cw - size.width * view.k) / 2;
        view.y = Math.max(20, (ch - size.height * view.k) / 2);
      }
      apply();
    };
    const zoomAt = (factor, px, py) => {
      const k = Math.min(3, Math.max(0.1, view.k * factor));
      view.x = px - ((px - view.x) * k) / view.k;
      view.y = py - ((py - view.y) * k) / view.k;
      view.k = k;
      apply();
    };

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      svg.setPointerCapture?.(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); svg.classList.add('panning'); }
    });
    const end = (e) => {
      svg.classList.remove('panning');
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;
      const hit = e.target.closest?.('[data-toggle]');
      if (!hit) return;
      const p = hit.getAttribute('data-toggle');
      if (collapsed.has(p)) collapsed.delete(p); else collapsed.add(p);
      render(container, ast, collapsed, view);
    };
    svg.addEventListener('pointerup', end);

    if (keepView) apply(); else fit(true);
    const ctl = {
      nodes: nodes.length,
      truncated,
      fit: () => fit(false),
      zoom: (f) => zoomAt(f, (container.clientWidth || 800) / 2, (container.clientHeight || 500) / 2),
      collapsed,
    };
    container.graph = ctl;
    return ctl;
  }

  return { render, build, layout };
})();
