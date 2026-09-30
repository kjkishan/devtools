'use strict';

/* ================================================================
   Small syntax highlighter for fenced code blocks (no library).
   Output is HTML with <span class="hl-*"> tokens; unknown languages
   are returned escaped and uncoloured.
   ================================================================ */

const CodeHighlight = (() => {
  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

  const JS_KW = words(`break case catch class const continue debugger default delete do else export extends finally for from
    function if import in instanceof let new of return static super switch this throw try typeof var void while with yield
    async await as implements interface enum type namespace declare readonly private protected public abstract keyof infer
    satisfies override get set`);
  const CS_KW = words(`abstract as base break case catch checked class const continue default delegate do else enum event
    explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out
    override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try
    typeof unchecked unsafe using virtual volatile while async await var record init get set value where yield nameof when
    required partial`);
  const JAVA_KW = words(`abstract assert break case catch class const continue default do else enum extends final finally for
    goto if implements import instanceof interface native new package private protected public return static strictfp super
    switch synchronized this throw throws transient try volatile while var record sealed permits yield`);
  const C_KW = words(`auto break case const continue default do else enum extern for goto if inline register restrict return
    sizeof static struct switch typedef union volatile while class namespace template typename using public private protected
    virtual override new delete this throw try catch operator friend constexpr nullptr noexcept`);
  const GO_KW = words(`break case chan const continue default defer else fallthrough for func go goto if import interface map
    package range return select struct switch type var`);
  const PY_KW = words(`and as assert async await break class continue def del elif else except finally for from global if
    import in is lambda nonlocal not or pass raise return try while with yield match case`);
  const SQL_KW = words(`select from where and or not insert into values update set delete create alter drop table view index
    procedure function trigger primary key foreign references join inner left right full outer cross on as group by order
    having distinct union all top limit offset case when then else end exists in between like is null declare begin commit
    rollback transaction with nolock merge using matched output identity default constraint unique check cascade asc desc
    over partition row_number count sum avg min max cast convert coalesce isnull getdate exec execute go return if while
    nvarchar varchar char nchar int bigint smallint tinyint bit decimal numeric float real date datetime datetime2
    datetimeoffset time uniqueidentifier money text ntext varbinary`);
  const SH_KW = words(`if then else elif fi for while until do done case esac function in return local export readonly
    declare echo exit set unset source alias cd sudo`);
  const PS_KW = words(`begin break catch class continue data define do dynamicparam else elseif end exit filter finally for
    foreach from function if in param process return switch throw trap try until using var while`);
  const LITERALS = words('true false null undefined NaN Infinity True False None nil NULL');
  // contextual keywords that are usually method names when called
  const SOFT = words('get set type as from of value init where async yield match case');
  const BUILTIN_TYPES = words(`string number boolean any unknown never void object bigint symbol int long short byte double float
    decimal bool char uint ulong ushort sbyte dynamic str bytes list dict tuple`);

  const C_LIKE = {
    comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
    string: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/y,
  };

  const LANGS = {
    js: { kw: JS_KW, ...C_LIKE, types: true, annotations: true },
    java: { kw: JAVA_KW, ...C_LIKE, types: true, annotations: true },
    cs: { kw: CS_KW, ...C_LIKE, string: /@"(?:""|[^"])*"|\$?"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y, types: true, annotations: false },
    c: { kw: C_KW, ...C_LIKE, types: true, preproc: true },
    go: { kw: GO_KW, ...C_LIKE, types: true },
    py: { kw: PY_KW, comment: /#[^\n]*/y, string: /("""|''')[\s\S]*?\1|[rbfu]*"(?:\\.|[^"\\\n])*"|[rbfu]*'(?:\\.|[^'\\\n])*'/iy, types: true, annotations: true },
    sql: { kw: SQL_KW, comment: /--[^\n]*|\/\*[\s\S]*?\*\//y, string: /N?'(?:''|[^'])*'|\[[^\]\n]+\]/y, caseless: true },
    sh: { kw: SH_KW, comment: /#[^\n]*/y, string: /"(?:\\.|[^"\\])*"|'[^']*'/y, vars: /\$\{?[\w@#?*!-]+\}?/y },
    ps: { kw: PS_KW, comment: /<#[\s\S]*?#>|#[^\n]*/y, string: /"(?:`.|[^"`])*"|'(?:''|[^'])*'/y, vars: /\$[\w:]+/y, caseless: true, cmdlets: true },
    css: { css: true },
    json: { json: true },
    yaml: { yaml: true },
    xml: { xml: true },
  };
  const ALIASES = {
    javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', tsx: 'js',
    csharp: 'cs', 'c#': 'cs', cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', cc: 'c', golang: 'go', kotlin: 'java', kt: 'java',
    python: 'py', python3: 'py', tsql: 'sql', mssql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql', plsql: 'sql',
    bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'ps', ps1: 'ps', pwsh: 'ps', scss: 'css', less: 'css',
    jsonc: 'json', json5: 'json', yml: 'yaml', html: 'xml', htm: 'xml', svg: 'xml', xaml: 'xml', vue: 'xml', csproj: 'xml',
  };

  const span = (cls, text) => `<span class="hl-${cls}">${escHtml(text)}</span>`;

  function generic(code, L) {
    const NUM = /0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[fFdDmMlLuUnN]*/y;
    const WORD = /[A-Za-z_$@][\w$]*/y;
    let out = '';
    let i = 0;
    const at = (re) => { re.lastIndex = i; const m = re.exec(code); return m ? m[0] : null; };
    while (i < code.length) {
      let m;
      if ((m = at(L.comment))) { out += span('com', m); i += m.length; continue; }
      if ((m = at(L.string))) { out += span('str', m); i += m.length; continue; }
      if (L.vars && (m = at(L.vars))) { out += span('attr', m); i += m.length; continue; }
      if (L.preproc && code[i] === '#' && /(^|\n)[ \t]*$/.test(code.slice(Math.max(0, i - 40), i))) {
        m = /#[^\n]*/y; m.lastIndex = i; const p = m.exec(code)[0];
        out += span('kw', p); i += p.length; continue;
      }
      if (L.annotations && code[i] === '@' && (m = at(/@[\w.]+/y))) { out += span('type', m); i += m.length; continue; }
      const prev = code[i - 1] || '';
      if (/\d|\./.test(code[i]) && !/[\w$]/.test(prev) && (m = at(NUM)) && /\d/.test(m)) { out += span('num', m); i += m.length; continue; }
      if ((m = at(WORD))) {
        const lower = m.toLowerCase();
        const isKw = L.caseless ? L.kw.has(lower) : L.kw.has(m);
        const next = code.slice(i + m.length).match(/^\s*(.)/)?.[1];
        if (LITERALS.has(m) || (L.caseless && LITERALS.has(m.toUpperCase()))) out += span('lit', m);
        else if (next === '(' && SOFT.has(m) && prev === '.') out += span('fn', m);
        else if (isKw) out += span('kw', m);
        else if (L.types && BUILTIN_TYPES.has(m)) out += span('type', m);
        else if (L.cmdlets && /^[A-Z][a-z]+-[A-Z]/.test(code.slice(i, i + m.length + 20))) {
          const c = /[A-Za-z]+-[A-Za-z]+/y; c.lastIndex = i; const cm = c.exec(code)[0];
          out += span('fn', cm); i += cm.length; continue;
        }
        else if (next === '(') out += span('fn', m);
        else if (L.types && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(m)) out += span('type', m);
        else out += escHtml(m);
        i += m.length;
        continue;
      }
      out += escHtml(code[i]);
      i++;
    }
    return out;
  }

  function json(code) {
    return escHtml(code).replace(
      /(&quot;|")((?:\\.|[^"\\])*?)"(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)|(\/\/[^\n]*)/g,
      (m, q, body, colon, lit, num, com) => {
        if (com) return `<span class="hl-com">${com}</span>`;
        if (lit) return `<span class="hl-lit">${lit}</span>`;
        if (num) return `<span class="hl-num">${num}</span>`;
        return `<span class="hl-${colon ? 'key' : 'str'}">"${body}"</span>${colon || ''}`;
      },
    );
  }

  function yaml(code) {
    return code.split('\n').map((line) => {
      const c = /^(\s*)(#.*)$/.exec(line);
      if (c) return escHtml(c[1]) + span('com', c[2]);
      const m = /^(\s*(?:-\s+)?)([^:#'"\s][^:#]*?|"[^"]*"|'[^']*')(\s*:)(\s|$)(.*)$/.exec(line);
      const valuePart = (v) => {
        const cm = /^(.*?)(\s#.*)?$/.exec(v);
        let val = cm[1];
        const tail = cm[2] ? span('com', cm[2]) : '';
        if (/^\s*(true|false|null|yes|no|~)\s*$/i.test(val)) val = span('lit', val);
        else if (/^\s*-?\d+(\.\d+)?\s*$/.test(val)) val = span('num', val);
        else if (/^\s*["']/.test(val)) val = span('str', val);
        else val = escHtml(val);
        return val + tail;
      };
      if (m) return escHtml(m[1]) + span('key', m[2]) + escHtml(m[3] + m[4]) + valuePart(m[5]);
      const li = /^(\s*-\s+)(.*)$/.exec(line);
      if (li) return escHtml(li[1]) + valuePart(li[2]);
      return escHtml(line);
    }).join('\n');
  }

  function xml(code) {
    let out = '';
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[\w:.-]+(?:\s+[\w:.@-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|<![^>]*>|<\?[\s\S]*?\?>/g;
    let last = 0;
    let m;
    while ((m = re.exec(code))) {
      out += escHtml(code.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('<!--')) out += span('com', t);
      else if (t.startsWith('<![CDATA[') || t.startsWith('<!') || t.startsWith('<?')) out += span('kw', t);
      else {
        out += t.replace(/^(<\/?)([\w:.-]+)|([\w:.@-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)|(\/?>)$/g, (x, open, name, attr, eq, val, close) => {
          if (open) return escHtml(open) + span('tag', name);
          if (attr) return span('attr', attr) + escHtml(eq) + span('str', val);
          return escHtml(close || x);
        });
      }
      last = re.lastIndex;
    }
    return out + escHtml(code.slice(last));
  }

  function css(code) {
    let out = '';
    const re = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|([\w-]+)(\s*:)(?![^{]*\{)|#[\da-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|mm|ch)?\b|@[\w-]+|[^{}]+?(?=\s*\{)/g;
    let last = 0;
    let m;
    while ((m = re.exec(code))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += escHtml(code.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('/*')) out += span('com', t);
      else if (t[0] === '"' || t[0] === "'") out += span('str', t);
      else if (m[1]) out += span('attr', m[1]) + escHtml(m[2]);
      else if (t[0] === '@') out += span('kw', t);
      else if (t[0] === '#' || /^-?\d|^\.\d/.test(t)) out += span('num', t);
      else out += span('tag', t);
      last = re.lastIndex;
    }
    return out + escHtml(code.slice(last));
  }

  function highlight(code, lang) {
    const key = String(lang || '').toLowerCase();
    const id = LANGS[key] ? key : ALIASES[key];
    const L = LANGS[id];
    if (!L) return escHtml(code);
    try {
      if (L.json) return json(code);
      if (L.yaml) return yaml(code);
      if (L.xml) return xml(code);
      if (L.css) return css(code);
      return generic(code, L);
    } catch {
      return escHtml(code);
    }
  }

  const supports = (lang) => {
    const key = String(lang || '').toLowerCase();
    return !!(LANGS[key] || ALIASES[key]);
  };

  return { highlight, supports };
})();
