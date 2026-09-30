'use strict';

/* ================================================================
   Markdown → HTML (GitHub-flavoured subset, no dependencies)
   Headings, paragraphs, emphasis, links, images, code, lists,
   task lists, tables, blockquotes, alerts, hr, page breaks.
   ================================================================ */

const Markdown = (() => {
  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => s.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const safeUrl = (u) => (/^\s*(?:javascript|vbscript|data(?!:image\/))\s*:/i.test(u) ? '#' : u);
  const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);

  const RE = {
    fence: /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/,
    heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
    hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    quote: /^ {0,3}> ?/,
    list: /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*$)/,
    tableSep: /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/,
    setext1: /^ {0,3}=+ *$/,
    setext2: /^ {0,3}-+ *$/,
    indentedCode: /^ {4,}\S/,
    pagebreak: /^ {0,3}(?:\\pagebreak|\\newpage|<!--\s*pagebreak\s*-->)\s*$/i,
    toc: /^ {0,3}(?:\[toc\]|\[\[_?toc_?\]\]|\$\{toc\})\s*$/i,
    htmlBlock: /^ {0,3}<(?:\/?(?:address|article|aside|blockquote|center|details|div|dl|dd|dt|figure|figcaption|footer|h[1-6]|header|hr|li|ol|p|pre|section|summary|table|tbody|td|th|thead|tr|ul|img|br|picture|video|audio)\b|!--)/i,
    refDef: /^ {0,3}\[([^\]^][^\]]*)\]:\s*<?([^\s>]+)>?(?:\s+["'(]([^"')]*)["')])?\s*$/,
  };
  const URL_PART = '((?:[^\\s()]|\\([^\\s()]*\\))+)';
  const TITLE_PART = '(?:\\s+(?:"([^"]*)"|\'([^\']*)\'))?';
  const IMG_RE = new RegExp(`!\\[([^\\]]*)\\]\\(\\s*${URL_PART}${TITLE_PART}\\s*\\)`, 'g');
  const LINK_RE = new RegExp(`\\[([^\\]]+)\\]\\(\\s*${URL_PART}?${TITLE_PART}\\s*\\)`, 'g');
  const ALERTS = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

  function sanitizeHtml(h) {
    return h
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|iframe|object|embed)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\b(href|src)\s*=\s*(["']?)\s*(?:javascript|vbscript):[^"'\s>]*\2/gi, '$1="#"');
  }

  function emph(s) {
    return s
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/==(?=\S)([^=]*?\S)==/g, '<mark>$1</mark>');
  }

  const TOC_MARK = '\u0001TOC\u0001';

  // nested list of the headings; a lone leading H1 is the document title, so it is left out
  function buildToc(headings) {
    let list = headings.filter((h) => h.level <= 3);
    const h1s = list.filter((h) => h.level === 1);
    if (h1s.length === 1 && list[0] === h1s[0]) list = list.slice(1);
    if (!list.length) return { html: '', ids: [] };
    const base = Math.min(...list.map((h) => h.level));
    let html = '<nav class="toc"><p class="toc-title">Contents</p><ul>';
    let cur = 0;
    list.forEach((h, k) => {
      const lvl = h.level - base;
      if (k === 0) html += '<li><ul>'.repeat(lvl);
      else if (lvl > cur) html += '<ul>'.repeat(lvl - cur);
      else html += `</li>${'</ul></li>'.repeat(cur - lvl)}`;
      cur = lvl;
      html += `<li><a href="#${escAttr(h.id)}">${h.text}</a>`;
    });
    html += `</li>${'</ul></li>'.repeat(cur)}</ul></nav>`;
    return { html, ids: list.map((h) => h.id) };
  }

  function render(src) {
    const refs = new Map();
    const slugs = new Map();
    const headings = [];
    let hasToc = false;
    let title = '';
    let firstHeading = '';

    let lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');

    // YAML front matter
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 1 && lines.slice(1, end).every((l) => !l.trim() || /^[\w-]+\s*:|^\s+|^-\s/.test(l))) lines = lines.slice(end + 1);
    }

    // reference-style link definitions
    let inFence = false;
    lines = lines.filter((l) => {
      if (RE.fence.test(l)) inFence = !inFence;
      if (inFence) return true;
      const m = RE.refDef.exec(l);
      if (!m) return true;
      refs.set(m[1].toLowerCase(), { url: m[2], title: m[3] });
      return false;
    });

    const cleanUrl = (u) => u.replace(/^&lt;/, '').replace(/&gt;$/, '');
    const img = (alt, url, t) =>
      `<img src="${escAttr(safeUrl(cleanUrl(url)))}" alt="${escAttr(alt.replace(/\u0000\d+\u0000/g, ''))}"${t ? ` title="${escAttr(t)}"` : ''}>`;
    const link = (txt, url, t) =>
      `<a href="${escAttr(safeUrl(cleanUrl(url || '#')))}"${t ? ` title="${escAttr(t)}"` : ''}>${emph(txt)}</a>`;

    function inline(text) {
      const slots = [];
      const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
      let s = text;
      s = s.replace(/(?: {2,}|\\)\n/g, () => keep('<br>'));
      s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code) =>
        keep(`<code>${escHtml(code.length > 2 && code.startsWith(' ') && code.endsWith(' ') ? code.slice(1, -1) : code)}</code>`));
      s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>=])/g, (_, c) => keep(escHtml(c)));
      s = s.replace(/<!--[\s\S]*?-->/g, '');
      s = s.replace(/<\/?(?:br|kbd|sub|sup|u|mark|span|b|i|em|strong|del|s|small|abbr|ins|img|a)\b[^>]*>/gi, (m) => keep(sanitizeHtml(m)));
      s = s.replace(/<((?:https?|ftp):\/\/[^\s<>]+)>/gi, (_, u) => keep(`<a href="${escAttr(u)}">${escHtml(u)}</a>`));
      s = s.replace(/<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>/g, (_, e) => keep(`<a href="mailto:${escAttr(e)}">${escHtml(e)}</a>`));
      s = escHtml(s);
      s = s.replace(IMG_RE, (_, alt, url, t1, t2) => keep(img(alt, url, t1 ?? t2)));
      s = s.replace(LINK_RE, (_, txt, url, t1, t2) => keep(link(txt, url, t1 ?? t2)));
      s = s.replace(/(!?)\[([^\]]+)\](?:\[([^\]]*)\])?/g, (m, bang, txt, ref) => {
        const r = refs.get(decode(ref || txt).toLowerCase());
        if (!r) return m;
        return keep(bang ? img(txt, r.url, r.title) : link(txt, r.url, r.title));
      });
      s = s.replace(/(^|[\s(>])((?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;!?"')\]*_~])/gi, (_, pre, u) =>
        pre + keep(`<a href="${escAttr(u.startsWith('www.') ? 'http://' + u : u)}">${u}</a>`));
      s = emph(s);
      let prev;
      do {
        prev = s;
        s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[n]);
      } while (s !== prev && s.includes('\u0000'));
      return s;
    }

    function heading(level, text) {
      const html = inline(text.trim());
      const plain = decode(html.replace(/<[^>]+>/g, '')).trim();
      let slug = plain.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      const n = slugs.get(slug) || 0;
      slugs.set(slug, n + 1);
      if (n) slug += `-${n}`;
      if (level === 1 && !title) title = plain;
      if (!firstHeading) firstHeading = plain;
      headings.push({ level, id: slug, text: escHtml(plain) });
      return `<h${level} id="${escAttr(slug)}">${html}</h${level}>`;
    }

    function isBlockStart(l) {
      return RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) ||
        RE.pagebreak.test(l) || RE.htmlBlock.test(l) || /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/.test(l);
    }

    const isTableStart = (ls, k) => ls[k].includes('|') && k + 1 < ls.length && RE.tableSep.test(ls[k + 1]) && ls[k + 1].includes('-');

    function splitRow(line) {
      let t = line.trim();
      if (t.startsWith('|')) t = t.slice(1);
      if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
      return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
    }

    function parseList(lines, start) {
      const first = RE.list.exec(lines[start]);
      const baseIndent = first[1].length;
      const ordered = /\d/.test(first[2]);
      const startNum = ordered ? parseInt(first[2], 10) : 1;
      const items = [];
      let loose = false;
      let i = start;

      const sameListItem = (l) => {
        const m = RE.list.exec(l);
        return m && m[1].length >= baseIndent && m[1].length <= baseIndent + 3 && /\d/.test(m[2]) === ordered;
      };

      while (i < lines.length && sameListItem(lines[i])) {
        const m = RE.list.exec(lines[i]);
        const ind = m[1].length;
        const gap = (lines[i].slice(ind + m[2].length).match(/^ */) || [''])[0].length;
        const contentIndent = ind + m[2].length + (gap >= 1 && gap <= 4 ? gap : 1);
        const body = [m[3] ?? ''];
        let sawBlank = false;
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) { body.push(''); sawBlank = true; i++; continue; }
          const lind = l.match(/^ */)[0].length;
          const lm = RE.list.exec(l);
          if (lind >= contentIndent) { body.push(l.slice(contentIndent)); sawBlank = false; i++; continue; }
          // lenient: a marker indented past the parent is a nested item even when under-indented
          if (lm && lind > baseIndent) { body.push(l.slice(lind)); sawBlank = false; i++; continue; }
          if (!sawBlank && !lm && !isBlockStart(l)) { body.push(l.trim()); i++; continue; }
          break;
        }
        let trailingBlank = false;
        while (body.length > 1 && !body[body.length - 1].trim()) { body.pop(); trailingBlank = true; }
        if (body.some((l, k) => !l.trim() && k > 0 && k < body.length - 1 && !/^\s*([-*+]|\d+[.)])\s/.test(body[k + 1]))) loose = true;
        if (trailingBlank && i < lines.length && sameListItem(lines[i])) loose = true;
        items.push(body);
      }

      let hasTask = false;
      const html = items.map((body) => {
        const tm = /^\[([ xX])\](?:[ \t]+|$)/.exec(body[0]);
        let box = '';
        if (tm) {
          hasTask = true;
          box = `<input type="checkbox" disabled${tm[1] !== ' ' ? ' checked' : ''}> `;
          body[0] = body[0].slice(tm[0].length);
        }
        return `<li${tm ? ' class="task"' : ''}>${box}${parseBlocks(body, !loose)}</li>`;
      }).join('');

      const tag = ordered ? 'ol' : 'ul';
      const attrs = (ordered && startNum !== 1 ? ` start="${startNum}"` : '') + (hasTask ? ' class="contains-task"' : '');
      return { html: `<${tag}${attrs}>${html}</${tag}>`, next: i };
    }

    function parseBlocks(lines, tight = false) {
      const out = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        let m;

        if (RE.pagebreak.test(line)) { out.push('<div class="page-break"></div>'); i++; continue; }
        if (RE.toc.test(line)) { out.push(TOC_MARK); hasToc = true; i++; continue; }

        if ((m = RE.fence.exec(line))) {
          const indent = m[1].length;
          const marker = m[2];
          const lang = m[3];
          const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
          const strip = new RegExp(`^ {0,${indent}}`);
          const body = [];
          i++;
          while (i < lines.length && !close.test(lines[i])) body.push(lines[i++].replace(strip, ''));
          i++;
          const code = body.join('\n');
          if (lang.toLowerCase() === 'mermaid') {
            // rendered to SVG by the preview; the source shows until then
            out.push(`<div class="mermaid-block" data-src="${escAttr(escHtml(code))}"><pre class="mermaid-src">${escHtml(code)}</pre></div>`);
            continue;
          }
          const cls = lang ? ` class="language-${escAttr(lang)}"` : '';
          const body2 = typeof CodeHighlight !== 'undefined' ? CodeHighlight.highlight(code, lang) : escHtml(code);
          out.push(`<pre${lang ? ` data-lang="${escAttr(lang)}"` : ''}><code${cls}>${body2}</code></pre>`);
          continue;
        }

        if ((m = RE.heading.exec(line))) { out.push(heading(m[1].length, m[2] || '')); i++; continue; }
        if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }

        if (RE.quote.test(line)) {
          const inner = [];
          while (i < lines.length && lines[i].trim() && (RE.quote.test(lines[i]) || !isBlockStart(lines[i]))) {
            inner.push(lines[i].replace(RE.quote, ''));
            i++;
          }
          const am = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(inner[0] || '');
          if (am) {
            const kind = am[1].toLowerCase();
            out.push(`<div class="alert alert-${kind}"><p class="alert-title">${ALERTS[kind]}</p>${parseBlocks(inner.slice(1))}</div>`);
          } else {
            out.push(`<blockquote>${parseBlocks(inner)}</blockquote>`);
          }
          continue;
        }

        if (RE.htmlBlock.test(line)) {
          const buf = [];
          while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
          out.push(sanitizeHtml(buf.join('\n')));
          continue;
        }

        if (isTableStart(lines, i)) {
          const head = splitRow(line);
          const aligns = splitRow(lines[i + 1]).map((c) => {
            const l = c.startsWith(':');
            const r = c.endsWith(':');
            return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
          });
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
          const cell = (tag, txt, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(txt)}</${tag}>`;
          let html = `<table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>`;
          if (rows.length) html += `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody>`;
          out.push(`${html}</table>`);
          continue;
        }

        if (RE.list.test(line)) {
          const r = parseList(lines, i);
          out.push(r.html);
          i = r.next;
          continue;
        }

        if (RE.indentedCode.test(line)) {
          const body = [];
          while (i < lines.length && (!lines[i].trim() || /^ {4}/.test(lines[i]))) body.push(lines[i++].slice(4));
          while (body.length && !body[body.length - 1].trim()) body.pop();
          out.push(`<pre><code>${escHtml(body.join('\n'))}</code></pre>`);
          continue;
        }

        // paragraph (with setext heading support)
        const buf = [line.trimStart()];
        let level = 0;
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) break;
          if (RE.setext1.test(l)) { level = 1; i++; break; }
          if (RE.setext2.test(l)) { level = 2; i++; break; }
          if (isBlockStart(l) || isTableStart(lines, i)) break;
          buf.push(l.trimStart());
          i++;
        }
        const text = buf.join('\n');
        if (level) out.push(heading(level, text));
        else out.push(tight ? inline(text.trimEnd()) : `<p>${inline(text.trimEnd())}</p>`);
      }
      return out.join('\n');
    }

    let html = parseBlocks(lines);
    let tocIds = [];
    if (hasToc) {
      const toc = buildToc(headings);
      tocIds = toc.ids;
      html = html.split(TOC_MARK).join(toc.html);
    }
    const words = (src.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    return { html, title: title || firstHeading, words, tocIds };
  }

  return { render };
})();
