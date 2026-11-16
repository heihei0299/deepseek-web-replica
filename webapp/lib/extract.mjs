// extract.mjs — 附件文本提取（零依赖）：纯文本 / 代码 / docx / xlsx 共享串 / pdf
import zlib from 'node:zlib';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'log', 'yml', 'yaml', 'xml', 'html', 'htm',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'go', 'rs', 'c', 'h', 'cpp', 'hpp',
  'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'sql', 'toml', 'ini', 'conf', 'env', 'svg', 'css', 'scss',
  'vue', 'svelte', 'tex', 'r', 'lua', 'swift', 'dart', 'gradle', 'properties',
]);

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/** 读 zip 中央目录，返回 name -> Buffer */
export function unzip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效 zip（无 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    try {
      files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    } catch {
      /* 跳过坏条目 */
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function docxText(buf) {
  const files = unzip(buf);
  const doc = files.get('word/document.xml') || files.get('word/document2.xml');
  if (!doc) throw new Error('docx 缺少 word/document.xml');
  const xml = doc.toString('utf8');
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function xlsxText(buf) {
  const files = unzip(buf);
  const shared = files.get('xl/sharedStrings.xml');
  if (!shared) throw new Error('xlsx 缺少 sharedStrings.xml');
  const strings = [...shared.toString('utf8').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'),
  );
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  const out = [];
  for (const s of sheets) {
    const xml = files.get(s).toString('utf8');
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
    const lines = rows.map((r) => {
      const cells = [...r[1].matchAll(/<c[^>]*?(?:\st="([^"]*)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?/g)];
      return cells
        .map((c) => {
          const t = c[1];
          const v = c[2] || '';
          return t === 's' ? strings[Number(v)] ?? '' : v;
        })
        .filter((x) => x !== '')
        .join('\t');
    });
    out.push(`# ${s.replace('xl/worksheets/', '')}\n${lines.join('\n')}`);
  }
  return out.join('\n\n').trim();
}

function pdfText(buf) {
  const latin = buf.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const raw = buf.subarray(start, end);
    let data = null;
    try {
      data = zlib.inflateSync(raw);
    } catch {
      try {
        data = zlib.inflateRawSync(raw.subarray(2));
      } catch {
        data = raw; // 未压缩流：直接按字节读
      }
    }
    if (!data) continue;
    const s = data.toString('latin1');
    // 括号字符串 + TJ 数组
    for (const bm of s.matchAll(/\((?:\\.|[^()\\])*\)/g)) {
      const txt = bm[0].slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c] ?? c));
      if (txt) chunks.push(txt);
    }
    if (/[\u4e00-\u9fff]/.test(s)) chunks.push('\n' + [...s.matchAll(/[\u4e00-\u9fff，。；：、！？（）]+/g)].map((x) => x[0]).join(''));
  }
  const text = chunks.join(' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('PDF 未提取到可读文本（可能为扫描件或使用了对象流压缩）');
  return text;
}

export function extractText(buf, filename) {
  const ext = extOf(filename);
  const note = [];

  if (TEXT_EXT.has(ext) || (!ext && buf.length < 2_000_000)) {
    return { text: buf.toString('utf8'), kind: ext || 'text', note };
  }
  if (ext === 'docx') return { text: docxText(buf), kind: 'docx', note };
  if (ext === 'xlsx') return { text: xlsxText(buf), kind: 'xlsx', note };
  if (ext === 'pdf') return { text: pdfText(buf), kind: 'pdf', note };
  if (ext === 'zip') {
    const files = unzip(buf);
    const texty = [...files.entries()].filter(([n]) => TEXT_EXT.has(extOf(n))).slice(0, 20);
    if (texty.length) {
      return {
        text: texty.map(([n, b]) => `### ${n}\n${b.toString('utf8')}`).join('\n\n'),
        kind: 'zip',
        note: [`压缩包内提取 ${texty.length} 个文本文件`],
      };
    }
  }
  throw new Error(`暂不支持 .${ext || '未知'} 的文本提取`);
}
