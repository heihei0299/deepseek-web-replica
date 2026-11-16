// markdown.js — 极简 Markdown 渲染器（无依赖）
// 支持：标题、段落、列表、引用、表格、分隔线、行内代码、代码块、加粗/斜体/删除线、
//       链接/自动链接、图片、$行内公式$ / $$块公式$$（有 KaTeX 时由其接管）

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'of', 'in',
  'class', 'extends', 'new', 'await', 'async', 'import', 'from', 'export', 'default', 'try',
  'catch', 'finally', 'throw', 'typeof', 'instanceof', 'switch', 'case', 'break', 'continue',
  'true', 'false', 'null', 'undefined', 'this', 'super', 'static', 'get', 'set',
  'def', 'None', 'True', 'False', 'self', 'elif', 'except', 'with', 'as', 'yield', 'lambda',
  'raise', 'pass', 'not', 'and', 'or', 'is', 'print', 'global', 'nonlocal', 'assert',
  'then', 'fi', 'done', 'do', 'esac', 'echo', 'cd', 'source', 'export',
  'func', 'package', 'type', 'struct', 'interface', 'range', 'go', 'defer', 'chan', 'select',
  'public', 'private', 'protected', 'void', 'int', 'float', 'double', 'boolean', 'string',
]);

const TOKEN_RE = new RegExp(
  [
    '(\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|--[^\\n]*)', // 1 comment
    '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)', // 2 string
    '\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b', // 3 number
    '([A-Za-z_$][\\w$]*)(?=\\s*\\()', // 4 call
    '([A-Za-z_$][\\w$]*)', // 5 word
  ].join('|'),
  'g',
);

export function highlight(code, lang = '') {
  const l = String(lang).toLowerCase();
  const plain = ['text', 'txt', 'plain', 'log', 'output', ''].includes(l);
  if (plain) return esc(code);

  let out = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN_RE)) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += `<span class="tok-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-num">${esc(m[3])}</span>`;
    else if (m[4]) {
      out += KEYWORDS.has(m[4]) ? `<span class="tok-key">${esc(m[4])}</span>` : `<span class="tok-fn">${esc(m[4])}</span>`;
    } else if (m[5]) {
      out += KEYWORDS.has(m[5]) ? `<span class="tok-key">${esc(m[5])}</span>` : esc(m[5]);
    }
    last = m.index + m[0].length;
  }
  out += esc(code.slice(last));
  return out;
}

function codeBlock(code, lang) {
  const label = lang || 'text';
  return (
    `<div class="code-block"><div class="code-head"><span>${esc(label)}</span>` +
    `<button class="code-copy" type="button" data-copy>` +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.4" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M15 6.6V5.4A1.4 1.4 0 0 0 13.6 4H5.4A1.4 1.4 0 0 0 4 5.4v8.2A1.4 1.4 0 0 0 5.4 15h1.2" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>' +
    '<span>复制</span></button></div>' +
    `<pre><code class="language-${esc(label)}">${highlight(code, label)}</code></pre></div>`
  );
}

function inline(text) {
  const codes = [];
  let s = String(text);

  // 数学公式先占位，避免被后续规则改写
  const maths = [];
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => `\u0002${maths.push({ m, block: true }) - 1}\u0002`);
  s = s.replace(/\$([^$\n]+?)\$/g, (_, m) => `\u0002${maths.push({ m, block: false }) - 1}\u0002`);

  // 行内代码
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `\u0001${codes.push(c) - 1}\u0001`);
  s = esc(s);

  // 图片 → 链接 → 自动链接
  s = s.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${src}" loading="lazy" />`);
  s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|#[^)\s]*)\)/g,
    (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t || u}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>")]+)/g,
    (_, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

  // 强调
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 回填
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => {
    const { m, block } = maths[Number(i)];
    return block
      ? `<span class="math math-block">${esc(m)}</span>`
      : `<span class="math math-inline">${esc(m)}</span>`;
  });
  return s;
}

const isTableSep = (l) => /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(l) && l.includes('-');
const startsBlock = (l) =>
  /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*([-*+]|\d+\.)\s/.test(l) ||
  /^>/.test(l) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) || /^\s*\|/.test(l);

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    // 代码块
    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i += 1;
      out.push(codeBlock(buf.join('\n'), lang));
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2].trim())}</h${lv}>`);
      i += 1;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr />'); i += 1; continue; }

    // 引用
    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>',
      );
      continue;
    }

    // 列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      let indent = 0;
      while (i < lines.length && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (m) {
          indent = m[1].length;
          items.push({ depth: Math.min(2, Math.floor(indent / 2)), text: m[3] });
        } else if (items.length) {
          items[items.length - 1].text += '\n' + lines[i].trim();
        }
        i += 1;
      }
      let html = ordered ? '<ol>' : '<ul>';
      for (const it of items) {
        const body = inline(it.text).replace(/\n/g, '<br />');
        if (it.depth > 0) html += `<li class="nested">${body}</li>`;
        else html += `<li>${body}</li>`;
      }
      html += ordered ? '</ol>' : '</ul>';
      out.push(html);
      continue;
    }

    // 段落
    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br />')}</p>`);
  }

  return out.join('\n');
}

export default renderMarkdown;
