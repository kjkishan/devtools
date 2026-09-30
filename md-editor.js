'use strict';

/* ================= Markdown editor toolbar ================= */

(() => {
  const ta = document.getElementById('mdInput');
  const bar = document.getElementById('mdToolbar');

  // replace [start, end) and keep native undo where the browser supports it
  function replace(start, end, text, selStart, selEnd) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(start + selStart, start + selEnd);
  }

  function wrap(before, after, placeholder) {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    // toggle off when the selection is already wrapped
    if (sel && value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
      replace(s - before.length, e + after.length, sel, 0, sel.length);
      return;
    }
    const inner = sel || placeholder;
    replace(s, e, before + inner + after, before.length, before.length + inner.length);
  }

  function lineRange() {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const start = value.lastIndexOf('\n', s - 1) + 1;
    let end = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
    if (end < 0) end = value.length;
    return { start, end, lines: value.slice(start, end).split('\n') };
  }

  // add or remove a prefix on every selected line
  function prefixLines(make, test) {
    const { start, end, lines } = lineRange();
    const all = lines.every((l) => !l.trim() || test.test(l));
    const out = lines.map((l, k) => {
      if (!l.trim()) return l;
      return all ? l.replace(test, '') : make(k) + l.replace(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '$1');
    });
    const text = out.join('\n');
    replace(start, end, text, 0, text.length);
  }

  function cycleHeading() {
    const { start, end, lines } = lineRange();
    const line = lines[0];
    const m = /^(#{1,6})\s+/.exec(line);
    const level = m ? m[1].length : 0;
    const next = level >= 3 ? 0 : level + 1;
    const bare = line.replace(/^#{1,6}\s+/, '');
    const text = (next ? `${'#'.repeat(next)} ` : '') + bare + (lines.length > 1 ? `\n${lines.slice(1).join('\n')}` : '');
    replace(start, end, text, text.length, text.length);
  }

  // insert a block on its own lines, with blank lines around it
  function block(text, selectFrom = null, selectTo = null) {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const before = value.slice(0, s);
    const after = value.slice(e);
    const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trail = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const full = lead + text + trail;
    const a = selectFrom == null ? lead.length + text.length : lead.length + selectFrom;
    const b = selectTo == null ? a : lead.length + selectTo;
    replace(s, e, full, a, b);
  }

  const TABLE = '| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell     | Cell     | Cell     |\n| Cell     | Cell     | Cell     |';
  const MERMAID = '```mermaid\nflowchart LR\n  A[Start] --> B{Check}\n  B -- yes --> C[Done]\n  B -- no --> D[Fix]\n```';

  const commands = {
    bold: () => wrap('**', '**', 'bold text'),
    italic: () => wrap('*', '*', 'italic text'),
    strike: () => wrap('~~', '~~', 'text'),
    code: () => wrap('`', '`', 'code'),
    heading: cycleHeading,
    link: () => {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const sel = value.slice(s, e) || 'link text';
      const text = `[${sel}](https://)`;
      replace(s, e, text, sel.length + 3, text.length - 1);
    },
    image: () => {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const alt = value.slice(s, e) || 'description';
      const text = `![${alt}](image.png)`;
      replace(s, e, text, alt.length + 4, text.length - 1);
    },
    quote: () => prefixLines(() => '> ', /^>\s?/),
    ul: () => prefixLines(() => '- ', /^\s*[-*+]\s+(?!\[[ xX]\])/),
    ol: () => prefixLines((k) => `${k + 1}. `, /^\s*\d+[.)]\s+/),
    task: () => prefixLines(() => '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/),
    codeblock: () => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      const body = sel || 'code';
      block(`\`\`\`ts\n${body}\n\`\`\``, 3, 5);
    },
    table: () => block(TABLE, 2, 10),
    hr: () => block('---'),
    toc: () => block('[TOC]'),
    pagebreak: () => block('\\pagebreak'),
    mermaid: () => block(MERMAID),
  };

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (btn && commands[btn.dataset.cmd]) commands[btn.dataset.cmd]();
  });

  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && key === 'b') { e.preventDefault(); commands.bold(); }
    else if (mod && !e.shiftKey && !e.altKey && key === 'i') { e.preventDefault(); commands.italic(); }
    else if (mod && !e.shiftKey && !e.altKey && key === 'k') { e.preventDefault(); commands.link(); }
    else if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) {
        const { start, end, lines } = lineRange();
        const text = lines.map((l) => l.replace(/^ {1,2}/, '')).join('\n');
        replace(start, end, text, 0, text.length);
      } else if (ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) {
        const { start, end, lines } = lineRange();
        const text = lines.map((l) => `  ${l}`).join('\n');
        replace(start, end, text, 0, text.length);
      } else {
        replace(ta.selectionStart, ta.selectionEnd, '  ', 2, 2);
      }
    } else if (e.key === 'Enter' && !mod && !e.shiftKey) {
      // continue lists: "- ", "1. ", "- [ ] ", "> "
      const { selectionStart: s, value } = ta;
      if (s !== ta.selectionEnd) return;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, s);
      const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[5].trim()) {
        replace(lineStart, s, '', 0, 0);
        return;
      }
      let marker = m[2];
      if (m[3]) marker = `${Number(m[3]) + 1}${m[4]} `;
      else if (/\[[xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]');
      const text = `\n${m[1]}${marker}`;
      replace(s, s, text, text.length, text.length);
    }
  });
})();
