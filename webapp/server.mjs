#!/usr/bin/env node
// DeepSeek Web Replica — 零依赖后端
//   /api/chat      SSE（mock / 官方 API / 官方 Web 会话通道）
//   /api/web/*     官方 Web 通道：challenge、session、stop
//   /api/upload    附件文本提取
//   /api/share     会话分享（只读页 /s/:id）
//
// 协议依据：docs/web-analysis.md（token + PoW 头 + SSE 路径补丁）

import http from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { createSession, createPowChallenge, streamChat, stopStream } from './lib/deepseek-web.mjs';
import { extractText } from './lib/extract.mjs';
import { renderMarkdown } from './public/markdown.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const API_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const ENV_KEY = process.env.DEEPSEEK_API_KEY || '';
const SYSTEM_PROMPT = process.env.DS_SYSTEM_PROMPT || '';
const SEARCH_ENABLED = process.env.SEARCH_ENABLED !== '0';
const SEARCH_LIMIT = Number(process.env.SEARCH_LIMIT || 5);
const MAX_UPLOAD = 16 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function html(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = MAX_UPLOAD * 1.4) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const sse = {
  open(res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders?.();
  },
  send(res, obj) {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* 客户端已断开 */
    }
  },
  done(res) {
    if (res.writableEnded) return;
    try {
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {
      /* ignore */
    }
  },
};

// ---------------------------------------------------------------- search
const searchCache = new Map();

const stripTags = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchText(url, ms = 5000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    });
    if (!r.ok) return '';
    return await r.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function searchBing(q) {
  const xml = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&setlang=zh-hans`);
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => stripTags((block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '');
    const url = pick('link');
    if (!/^https?:/i.test(url)) continue;
    out.push({ title: pick('title') || url, url, snippet: pick('description').slice(0, 220) });
    if (out.length >= SEARCH_LIMIT) break;
  }
  return out;
}

async function searchDDG(q) {
  const page = await fetchText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`);
  if (!page || !page.includes('result-link')) return [];
  const links = [...page.matchAll(/<a\b[^>]*class=['"]?result-link['"]?[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    tag: m[0],
    title: stripTags(m[1]),
  }));
  const snips = [...page.matchAll(/<td[^>]*class=['"]?result-snippet['"]?[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
  const out = [];
  links.forEach((l, i) => {
    const href = (l.tag.match(/href=["']([^"']+)["']/) || [])[1] || '';
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    const url = uddg ? decodeURIComponent(uddg[1]) : href;
    if (!/^https?:/i.test(url)) return;
    out.push({ title: l.title || url, url, snippet: (snips[i] || '').slice(0, 220) });
  });
  return out.slice(0, SEARCH_LIMIT);
}

async function webSearch(q) {
  const key = q.trim().slice(0, 200);
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.sources;
  let sources = [];
  for (const fn of [searchBing, searchDDG]) {
    try {
      sources = await fn(key);
    } catch {
      sources = [];
    }
    if (sources.length) break;
  }
  searchCache.set(key, { at: Date.now(), sources });
  return sources;
}

const searchContext = (sources) =>
  sources.length
    ? `以下是与用户问题相关的联网检索结果（可能不完整、可能过时）。回答时若使用请标注编号，如 [1]；资料不足就直接说明。\n\n` +
      sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`).join('\n\n')
    : '';

// ---------------------------------------------------------------- upstream API
async function* streamCompletion({ key, base, model, messages, signal }) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, accept: 'text/event-stream' },
    body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
  });

  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => '');
    let msg = text;
    try {
      msg = JSON.parse(text)?.error?.message || text;
    } catch {}
    throw new Error(`${r.status} ${msg}`.trim() || 'upstream error');
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch {
          continue;
        }
        const d = ev.choices?.[0]?.delta || {};
        if (d.reasoning_content) yield { type: 'thinking', v: d.reasoning_content };
        if (d.content) yield { type: 'content', v: d.content };
        if (ev.usage) yield { type: 'usage', v: ev.usage };
      }
    }
  }
}

// ---------------------------------------------------------------- mock
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockReply(prompt, thinking) {
  const q = prompt.replace(/\s+/g, ' ').trim().slice(0, 80) || '这个问题';
  const think = thinking
    ? [
        `用户在问：${q}`,
        '本地演示模式没有真实模型，所以这里给的是可验证的结构化回复：思考块、Markdown、代码块、表格、停止生成。',
        '结论先行，细节跟上。',
      ].join('\n\n')
    : '';
  const body = `### 先说结论

这是 **本地演示回复**，用来验证界面链路，不代表真实模型输出。你刚才问的是：

> ${q}

要接真实模型：填 API Key（官方 API 通道），或在设置里切到「官方 Web 会话」并粘贴自己的 userToken。

### 渲染检查清单

| 能力 | 状态 |
| --- | --- |
| 流式输出 | ✅ 逐字到达 |
| 深度思考块 | ✅ 可折叠 |
| 代码高亮 | ✅ 基础高亮 + 复制 |
| 表格 / 引用 / 列表 | ✅ |

\`\`\`js
for await (const ev of streamChat(token, body, { powHeader })) {
  sse.send(res, ev);   // {type:'thinking'|'content'|'done'}
}
\`\`\`

> 提示：Enter 发送，Shift + Enter 换行；生成中再按发送键可停止。

祝玩得开心。`;
  return { think, body };
}

function* chunks(s, n) {
  for (let i = 0; i < s.length; i += n) yield s.slice(i, i + n);
}

async function runMock(res, { prompt, thinking }) {
  const { think, body } = mockReply(prompt, thinking);
  const t0 = Date.now();
  if (think) {
    for (const chunk of chunks(think, 6)) {
      if (res.writableEnded) return;
      sse.send(res, { type: 'thinking', v: chunk });
      await sleep(12);
    }
  }
  for (const chunk of chunks(body, 5)) {
    if (res.writableEnded) return;
    sse.send(res, { type: 'content', v: chunk });
    await sleep(9);
  }
  sse.send(res, { type: 'usage', v: { ms: Date.now() - t0, mock: true } });
}

// ---------------------------------------------------------------- share
const SHARE_FILE = path.join(DATA, 'shares.json');
let shares = null;

async function loadShares() {
  if (shares) return shares;
  try {
    shares = JSON.parse(await readFile(SHARE_FILE, 'utf8'));
  } catch {
    shares = {};
  }
  return shares;
}

async function saveShares() {
  await mkdir(DATA, { recursive: true }).catch(() => {});
  await writeFile(SHARE_FILE, JSON.stringify(shares, null, 2)).catch(() => {});
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sharePage(share) {
  const rows = share.messages
    .map((m) =>
      m.role === 'user'
        ? `<div class="u"><div class="bubble">${esc(m.content)}</div></div>`
        : `<div class="a"><div class="name">DeepSeek</div><div class="md">${renderMarkdown(m.content || '')}</div></div>`,
    )
    .join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(share.title)} · DeepSeek 分享</title>
<style>
:root{--brand:#4d6bfe;--bg:#fff;--fg:#0f1115;--muted:#61666b;--line:rgba(0,0,0,.1);--code:#f6f8fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.75 Inter,system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);font-size:13px;margin-bottom:28px}
.u{display:flex;justify-content:flex-end;margin:18px 0}.bubble{max-width:82%;background:#f1f3f5;border-radius:20px;padding:9px 16px;white-space:pre-wrap}
.a{margin:6px 0 26px}.name{color:var(--muted);font-size:13px;margin-bottom:4px}
.md code{background:#f1f3f5;border-radius:5px;padding:1px 5px;font-family:Menlo,Consolas,monospace;font-size:.88em}
.code-block{margin:0 0 14px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--code)}
.code-head{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:#eef1f5;color:#81858c;font:12px/1.6 Menlo,Consolas,monospace}
.code-copy{display:none}
.md pre{margin:0;padding:12px 14px;overflow-x:auto;background:transparent;border:0}
.md pre code{background:none;padding:0;font-size:13px}
.md table{border-collapse:collapse;width:100%;font-size:14px}.md th,.md td{border:1px solid var(--line);padding:7px 12px;text-align:left}
.md th{background:#f5f7fa}.md blockquote{margin:0 0 12px;padding-left:14px;border-left:3px solid var(--line);color:var(--muted)}
.foot{margin-top:40px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
a{color:var(--brand)}
</style></head><body><div class="wrap">
<h1>${esc(share.title)}</h1>
<div class="sub">分享于 ${new Date(share.createdAt).toLocaleString('zh-CN')} · 只读副本</div>
${rows}
<div class="foot">由 DeepSeek 网页版复刻生成 · 内容由 AI 生成，请仔细甄别</div>
</div></body></html>`;
}

// ---------------------------------------------------------------- chat
async function handleChat(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'bad json' });
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  const thinking = Boolean(body.thinking);
  const wantSearch = Boolean(body.search) && SEARCH_ENABLED;

  const key = String(req.headers['x-deepseek-key'] || ENV_KEY || '').trim();
  const token = String(req.headers['x-deepseek-token'] || '').trim();
  const powHeader = String(req.headers['x-ds-pow'] || '').trim();
  const base = String(req.headers['x-deepseek-base'] || API_BASE).replace(/\/+$/, '');
  const forced = String(req.headers['x-provider'] || process.env.DEEPSEEK_PROVIDER || '').trim();

  let channel = String(body.channel || forced || '').trim();
  if (!['mock', 'api', 'web'].includes(channel)) channel = key ? 'api' : 'mock';
  if (channel === 'web' && !token) {
    sse.open(res);
    sse.send(res, { type: 'error', v: 'Web 通道需要 userToken：设置 → 官方 Web 会话 → 填入自己的 token' });
    sse.send(res, { type: 'done', v: { finish: 'error' } });
    return sse.done(res);
  }

  const model = String(body.model || (thinking ? 'deepseek-reasoner' : 'deepseek-chat'));

  sse.open(res);
  let closed = false;
  const ac = new AbortController();
  req.on('close', () => {
    closed = true;
    ac.abort();
  });

  try {
    if (channel === 'web') {
      let sessionId = body.session_id || null;
      if (!sessionId) {
        sessionId = await createSession(token);
        if (!sessionId) throw new Error('创建会话失败：上游未返回 session id');
      }
      sse.send(res, { type: 'start', v: { provider: 'web', model: 'DeepSeek', sessionId } });

      let sources = [];
      if (wantSearch && lastUser) {
        sources = await webSearch(lastUser);
        sse.send(res, { type: 'search', v: { sources } });
      }

      const prompt = String(body.prompt ?? lastUser);
      const upstream = {
        chat_session_id: sessionId,
        parent_message_id: body.parent_message_id ?? null,
        prompt,
        ref_file_ids: Array.isArray(body.ref_file_ids) ? body.ref_file_ids : [],
        thinking_enabled: thinking,
        search_enabled: wantSearch,
        model_type: body.model_type ?? null,
        action: null,
        preempt: false,
      };

      let lastMessageId = null;
      await streamChat(token, upstream, {
        powHeader,
        signal: ac.signal,
        onEvent: (ev) => {
          if (closed) return;
          if (ev.type === 'meta' && ev.v?.message_id) lastMessageId = ev.v.message_id;
          sse.send(res, ev);
        },
      });
      if (!closed) sse.done(res);
      if (closed) await stopStream(token, sessionId, lastMessageId).catch(() => {});
      return;
    }

    sse.send(res, { type: 'start', v: { provider: channel, model, thinking, search: wantSearch } });

    let sources = [];
    if (wantSearch && lastUser) {
      sources = await webSearch(lastUser);
      sse.send(res, { type: 'search', v: { sources } });
    }

    if (channel === 'mock') {
      if (wantSearch) {
        sse.send(res, {
          type: 'notice',
          v: `演示模式不调用模型；本次检索到 ${sources.length} 条结果，已展示在上方。`,
        });
      }
      await runMock(res, { prompt: lastUser, thinking });
      if (!closed) sse.send(res, { type: 'done', v: { finish: 'stop' } });
      return sse.done(res);
    }

    const messages = [];
    const sys = [SYSTEM_PROMPT, searchContext(sources)].filter(Boolean).join('\n\n');
    if (sys) messages.push({ role: 'system', content: sys });
    for (const m of history.slice(-40)) {
      if (!m?.content || !['user', 'assistant'].includes(m.role)) continue;
      messages.push({ role: m.role, content: String(m.content) });
    }

    for await (const ev of streamCompletion({ key, base, model, messages, signal: ac.signal })) {
      if (closed) break;
      sse.send(res, ev);
    }
    if (!closed) sse.send(res, { type: 'done', v: { finish: 'stop' } });
    sse.done(res);
  } catch (err) {
    if (closed) return;
    const msg = err?.name === 'AbortError' ? '已停止生成' : String(err?.message || err);
    sse.send(res, { type: 'error', v: msg });
    sse.send(res, { type: 'done', v: { finish: 'error' } });
    sse.done(res);
  }
}

// ---------------------------------------------------------------- static
async function handleStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return json(res, 400, { error: 'bad path' });
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  try {
    const st = await stat(abs);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(abs).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

// ---------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/api/config') {
    return json(res, 200, {
      provider: process.env.DEEPSEEK_PROVIDER || (ENV_KEY ? 'api' : 'mock'),
      hasEnvKey: Boolean(ENV_KEY),
      apiBase: API_BASE,
      search: SEARCH_ENABLED,
      searchLimit: SEARCH_LIMIT,
      channels: ['mock', 'api', 'web'],
      models: [
        { id: 'deepseek-chat', label: 'DeepSeek-V3.2' },
        { id: 'deepseek-reasoner', label: 'DeepSeek-R1' },
      ],
      version: '1.1.0',
    });
  }

  if (p === '/api/search') {
    const q = url.searchParams.get('q') || '';
    if (!q) return json(res, 400, { error: 'q required' });
    return json(res, 200, { sources: await webSearch(q) });
  }

  if (p === '/api/chat' && req.method === 'POST') return handleChat(req, res);

  if (p === '/api/web/pow' && req.method === 'POST') {
    const token = String(req.headers['x-deepseek-token'] || '').trim();
    if (!token) return json(res, 401, { error: '缺少 token' });
    try {
      const body = await readBody(req);
      const challenge = await createPowChallenge(token, body.target_path || '/api/v0/chat/completion');
      return json(res, 200, { challenge });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (p === '/api/web/session' && req.method === 'POST') {
    const token = String(req.headers['x-deepseek-token'] || '').trim();
    if (!token) return json(res, 401, { error: '缺少 token' });
    try {
      return json(res, 200, { session_id: await createSession(token) });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (p === '/api/web/stop' && req.method === 'POST') {
    const token = String(req.headers['x-deepseek-token'] || '').trim();
    if (!token) return json(res, 401, { error: '缺少 token' });
    try {
      const body = await readBody(req);
      await stopStream(token, body.session_id, body.message_id ?? null);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (p === '/api/upload' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const name = String(body.name || 'file');
      const buf = Buffer.from(String(body.data || ''), 'base64');
      if (!buf.length) return json(res, 400, { error: '空文件' });
      if (buf.length > MAX_UPLOAD) return json(res, 413, { error: '文件超过 16 MB' });
      const { text, kind, note } = extractText(buf, name);
      const clipped = text.length > 200_000 ? text.slice(0, 200_000) : text;
      return json(res, 200, {
        name,
        kind,
        chars: text.length,
        text: clipped,
        truncated: clipped.length < text.length,
        note,
      });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (p === '/api/share' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const s = body.session;
      if (!s || !Array.isArray(s.messages)) return json(res, 400, { error: '缺少会话' });
      const store = await loadShares();
      const id = crypto.randomBytes(6).toString('base64url');
      store[id] = {
        id,
        title: String(s.title || '未命名会话').slice(0, 80),
        createdAt: Date.now(),
        messages: s.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content || '' })),
      };
      await saveShares();
      return json(res, 200, { id, url: `/s/${id}` });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  if (p.startsWith('/s/')) {
    const id = p.slice(3);
    const store = await loadShares();
    const s = store[id];
    if (!s) return html(res, 404, '<h1 style="font-family:system-ui">分享不存在或已删除</h1>');
    return html(res, 200, sharePage(s));
  }

  if (p.startsWith('/api/share/')) {
    const id = p.slice('/api/share/'.length);
    const store = await loadShares();
    return store[id] ? json(res, 200, store[id]) : json(res, 404, { error: 'not found' });
  }

  if (p === '/healthz') return json(res, 200, { ok: true, uptime: process.uptime() });

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
  return handleStatic(req, res, p);
});

server.listen(PORT, HOST, () => {
  log(`deepseek replica on http://${HOST}:${PORT}  api=${ENV_KEY ? 'key' : 'none'}  search=${SEARCH_ENABLED ? 'on' : 'off'}  channels=mock/api/web`);
});
