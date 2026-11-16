// app.js — DeepSeek 网页版复刻（前端）
import { renderMarkdown } from './markdown.js';
import { solveChallenge, powHeaderValue } from './pow.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const LS = { sessions: 'dsr.sessions.v1', settings: 'dsr.settings.v1', theme: 'dsr.theme' };
const read = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const stored = read(LS.settings, {});
const state = {
  sessions: read(LS.sessions, []),
  currentId: null,
  settings: {
    key: stored.key || '',
    base: stored.base || '',
    channel: stored.channel || stored.provider || 'auto',
    token: stored.token || '',
  },
  pendingFiles: [],
  cfg: { provider: 'mock', models: [{ id: 'deepseek-chat', label: 'DeepSeek' }], search: true },
  streaming: false,
  controller: null,
  thinkStartedAt: 0,
  paintQueued: false,
  live: null, // 当前流式消息 { msg, el, thinkBody, thinkHead, mdEl, headerLabel }
};

const dom = {
  app: $('#app'),
  sidebar: $('#sidebar'),
  scrim: $('#scrim'),
  convList: $('#convList'),
  welcome: $('#welcome'),
  messages: $('#messages'),
  thread: $('#thread'),
  input: $('#input'),
  sendBtn: $('#sendBtn'),
  thinkBtn: $('#thinkBtn'),
  searchBtn: $('#searchBtn'),
  attachBtn: $('#attachBtn'),
  providerBadge: $('#providerBadge'),
  providerSub: $('#providerSub'),
  modelName: $('#modelName'),
  settingsModal: $('#settingsModal'),
  attachments: $('#attachments'),
  fileInput: $('#fileInput'),
  toast: $('#toast'),
};

// ---------------------------------------------------------------- helpers
function toast(text, ms = 2200) {
  dom.toast.textContent = text;
  dom.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => dom.toast.classList.remove('show'), ms);
}

function currentSession() {
  return state.sessions.find((s) => s.id === state.currentId) || null;
}

function resolveChannel() {
  const c = state.settings.channel;
  if (c === 'web' || c === 'api' || c === 'mock') return c;
  return state.settings.key || state.cfg.hasEnvKey ? 'api' : state.cfg.provider === 'api' ? 'api' : 'mock';
}

function withFiles(m) {
  if (!m.files?.length) return m.content;
  return `${m.content}\n\n${m.files.map((f) => `【附件：${f.name}】\n${f.text}`).join('\n\n')}`;
}

function touch(session) {
  session.updatedAt = Date.now();
  state.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  write(LS.sessions, state.sessions);
}

function newSession({ silent = false } = {}) {
  const s = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  state.sessions.unshift(s);
  state.currentId = s.id;
  write(LS.sessions, state.sessions);
  renderSidebar();
  renderThread();
  closeSidebar();
  if (!silent) dom.input.focus();
  return s;
}

function closeSidebar() {
  dom.app.classList.remove('sidebar-open');
  dom.scrim.classList.remove('show');
}

const nearBottom = () => dom.thread.scrollHeight - dom.thread.scrollTop - dom.thread.clientHeight < 140;

function scrollToBottom() {
  dom.thread.scrollTop = dom.thread.scrollHeight;
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const pref = localStorage.getItem(LS.theme) || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#themeBtn').innerHTML = `<svg><use href="#i-${dark ? 'moon' : 'sun'}"/></svg>`;
  $('#themeBtn').title = `主题：${pref === 'auto' ? '跟随系统' : pref === 'dark' ? '深色' : '浅色'}（点击切换）`;
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const cur = localStorage.getItem(LS.theme) || 'auto';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  localStorage.setItem(LS.theme, next);
  applyTheme();
  toast(`主题：${next === 'auto' ? '跟随系统' : next === 'dark' ? '深色' : '浅色'}`);
}

// ---------------------------------------------------------------- sidebar
function groupLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = (startOfToday - d.getTime()) / 86400000;
  if (d.getTime() >= startOfToday) return '今天';
  if (diff < 2) return '昨天';
  if (diff < 7) return '近 7 天';
  return '更早';
}

function renderSidebar() {
  dom.convList.innerHTML = '';
  if (!state.sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'conv-group-title';
    empty.textContent = '还没有会话';
    dom.convList.append(empty);
    return;
  }
  let lastGroup = '';
  for (const s of state.sessions) {
    const group = groupLabel(s.updatedAt);
    if (group !== lastGroup) {
      lastGroup = group;
      const t = document.createElement('div');
      t.className = 'conv-group-title';
      t.textContent = group;
      dom.convList.append(t);
    }
    const item = document.createElement('div');
    item.className = 'conv-item' + (s.id === state.currentId ? ' active' : '');
    item.dataset.id = s.id;

    const title = document.createElement('span');
    title.className = 'conv-title';
    title.textContent = s.title || '新对话';

    const del = document.createElement('button');
    del.className = 'conv-del';
    del.dataset.del = s.id;
    del.title = '删除该对话';
    del.innerHTML = '<svg><use href="#i-trash"/></svg>';

    item.append(title, del);
    dom.convList.append(item);
  }
}

function openSession(id) {
  state.currentId = id;
  renderSidebar();
  renderThread();
  closeSidebar();
}

function deleteSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`删除「${s.title}」？`)) return;
  state.sessions = state.sessions.filter((x) => x.id !== id);
  write(LS.sessions, state.sessions);
  if (state.currentId === id) {
    state.currentId = state.sessions[0]?.id || null;
    renderThread();
  }
  renderSidebar();
}

// ---------------------------------------------------------------- thread
function renderThread() {
  const s = currentSession();
  dom.messages.innerHTML = '';
  if (!s || !s.messages.length) {
    dom.welcome.classList.remove('hidden');
    dom.messages.classList.add('hidden');
    return;
  }
  dom.welcome.classList.add('hidden');
  dom.messages.classList.remove('hidden');
  for (const m of s.messages) dom.messages.append(buildMessage(m));
  requestAnimationFrame(scrollToBottom);
}

function buildMessage(msg) {
  if (msg.role === 'user') {
    const el = document.createElement('div');
    el.className = 'msg user';
    const b = document.createElement('div');
    b.className = 'bubble';
    const text = document.createElement('div');
    text.className = 'bubble-text';
    text.textContent = msg.content;
    b.append(text);
    if (msg.files?.length) {
      const chips = document.createElement('div');
      chips.className = 'bubble-files';
      for (const f of msg.files) {
        const chip = document.createElement('span');
        chip.className = 'bubble-file';
        chip.textContent = f.name;
        chips.append(chip);
      }
      b.append(chips);
    }
    el.append(b);
    return el;
  }

  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.dataset.id = msg.id;

  const avatar = document.createElement('div');
  avatar.className = 'assistant-avatar';
  avatar.innerHTML = '<svg><use href="#i-whale"/></svg>';

  const body = document.createElement('div');
  body.className = 'assistant-body';
  body.innerHTML = `
    <div class="assistant-name">DeepSeek</div>
    <div class="think" data-open="true" hidden>
      <button class="think-head" type="button">
        <svg><use href="#i-chevron"/></svg>
        <span class="think-label">正在思考…</span>
        <span class="think-dot"><i></i><i></i><i></i></span>
      </button>
      <div class="think-body md"></div>
    </div>
    <div class="search-sources" hidden></div>
    <div class="notice" hidden></div>
    <div class="md content"></div>
    <div class="error-box" hidden></div>
    <div class="msg-actions"></div>`;

  el.append(avatar, body);
  paintMessage(el, msg);
  return el;
}

function paintMessage(el, msg) {
  const think = $('.think', el);
  const thinkBody = $('.think-body', el);
  const thinkLabel = $('.think-label', el);
  const dot = $('.think-dot', el);
  const content = $('.content', el);
  const sources = $('.search-sources', el);
  const notice = $('.notice', el);
  const error = $('.error-box', el);
  const actions = $('.msg-actions', el);

  // thinking
  if (msg.thinking) {
    think.hidden = false;
    thinkBody.innerHTML = renderMarkdown(msg.thinking);
    if (msg.thinkElapsed) {
      thinkLabel.textContent = `已深度思考（用时 ${msg.thinkElapsed} 秒）`;
      dot.hidden = true;
    } else if (msg.thinking) {
      thinkLabel.textContent = '正在思考…';
      dot.hidden = false;
    }
  } else {
    think.hidden = true;
  }

  // sources
  if (msg.sources?.length) {
    sources.hidden = false;
    sources.innerHTML = msg.sources
      .filter((s) => /^https?:\/\//i.test(s.url || ''))
      .map(
        (s) =>
          `<a class="source-chip" href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(s.snippet)}">` +
          `<svg><use href="#i-globe"/></svg><span>${escapeHtml(s.title || s.url)}</span></a>`,
      )
      .join('');
  } else {
    sources.hidden = true;
  }

  if (msg.notice) {
    notice.hidden = false;
    notice.textContent = msg.notice;
  } else {
    notice.hidden = true;
  }

  // content
  content.innerHTML = renderMarkdown(msg.content || '') + (msg.streaming ? '<span class="caret"></span>' : '');
  if (msg.error) {
    error.hidden = false;
    error.textContent = msg.error;
  } else {
    error.hidden = true;
  }

  // actions
  if (msg.done || msg.stopped) {
    actions.classList.add('pinned');
    actions.innerHTML = `
      <button class="action-btn" data-act="copy" title="复制"><svg><use href="#i-copy"/></svg></button>
      <button class="action-btn" data-act="tts" title="朗读"><svg><use href="#i-speak"/></svg></button>
      <button class="action-btn" data-act="regen" title="重新生成"><svg><use href="#i-refresh"/></svg></button>
      <button class="action-label" data-act="like" title="有帮助"><svg><use href="#i-like"/></svg></button>
      <button class="action-label" data-act="dislike" title="没帮助"><svg><use href="#i-dislike"/></svg></button>`;
  } else {
    actions.innerHTML = '';
    actions.classList.remove('pinned');
  }
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeAttr = (s) => escapeHtml(s).replace(/\n/g, ' ');

// ---------------------------------------------------------------- send
function buildHistory(session, upTo) {
  const list = upTo ? session.messages.slice(0, upTo) : session.messages;
  return list
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && !m.error)
    .map((m) => ({ role: m.role, content: m.role === 'user' ? withFiles(m) : m.content }));
}

async function send(textOverride) {
  if (state.streaming) return stopStream();
  const text = (textOverride ?? dom.input.value).trim();
  if (!text && !state.pendingFiles.length) return;

  const channel = resolveChannel();
  if (channel === 'web' && !state.settings.token) {
    toast('Web 通道需要先填 userToken（设置 → 官方 Web 会话）');
    return;
  }

  let s = currentSession();
  if (!s) s = newSession({ silent: true });

  const files = state.pendingFiles.splice(0);
  renderAttachments();

  const userMsg = { id: uid(), role: 'user', content: text, ts: Date.now(), files };
  s.messages.push(userMsg);
  if (s.messages.length === 1) {
    s.title = (text || files[0]?.name || '新对话').slice(0, 24) + (text.length > 24 ? '…' : '');
  }

  const thinking = dom.thinkBtn.dataset.on === 'true';
  const search = dom.searchBtn.dataset.on === 'true';
  const assistant = {
    id: uid(),
    role: 'assistant',
    content: '',
    thinking: '',
    sources: [],
    notice: '',
    error: '',
    streaming: true,
    done: false,
    channel,
    model: thinking ? 'deepseek-reasoner' : 'deepseek-chat',
    ts: Date.now(),
  };
  s.messages.push(assistant);

  dom.welcome.classList.add('hidden');
  dom.messages.classList.remove('hidden');
  dom.messages.append(buildMessage(userMsg));
  const el = buildMessage(assistant);
  dom.messages.append(el);

  dom.input.value = '';
  autosize();
  updateSendState();
  scrollToBottom();
  touch(s);
  renderSidebar();

  state.streaming = true;
  state.thinkStartedAt = 0;
  setSendButton(true);

  const ac = new AbortController();
  state.controller = ac;

  const headers = { 'content-type': 'application/json' };
  if (state.settings.key) headers['x-deepseek-key'] = state.settings.key;
  if (state.settings.base) headers['x-deepseek-base'] = state.settings.base;
  if (channel === 'web') headers['x-deepseek-token'] = state.settings.token;

  const paint = () => {
    if (state.paintQueued) return;
    state.paintQueued = true;
    requestAnimationFrame(() => {
      state.paintQueued = false;
      const stick = nearBottom();
      paintMessage(el, assistant);
      if (stick) scrollToBottom();
    });
  };

  try {
    let powHeader = '';
    if (channel === 'web') {
      assistant.notice = '正在准备 PoW 挑战…';
      paint();
      const target = '/api/v0/chat/completion';
      const r = await fetch('/api/web/pow', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-deepseek-token': state.settings.token },
        body: JSON.stringify({ target_path: target }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `获取挑战失败（HTTP ${r.status}）`);
      const answer = await solveChallenge(j.challenge);
      powHeader = powHeaderValue(answer, target);
      assistant.notice = '';
      paint();
    }

    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: channel === 'web' ? { ...headers, 'x-ds-pow': powHeader } : headers,
      signal: ac.signal,
      body: JSON.stringify({
        channel,
        messages: buildHistory(s),
        model: assistant.model,
        thinking,
        search,
        session_id: channel === 'web' ? s.webSessionId || undefined : undefined,
        prompt: channel === 'web' ? withFiles(userMsg) : undefined,
      }),
    });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    const handle = (ev) => {
      switch (ev.type) {
        case 'start':
          assistant.provider = ev.v?.provider;
          if (ev.v?.sessionId) s.webSessionId = ev.v.sessionId;
          setProviderBadge(ev.v?.provider);
          break;
        case 'search':
          assistant.sources = ev.v?.sources || [];
          break;
        case 'notice':
          assistant.notice = ev.v || '';
          break;
        case 'title':
          if (ev.v) {
            s.title = String(ev.v).slice(0, 40);
            renderSidebar();
          }
          break;
        case 'thinking':
          if (!state.thinkStartedAt) state.thinkStartedAt = Date.now();
          assistant.thinking = ev.mode === 'set' ? String(ev.v || '') : assistant.thinking + ev.v;
          break;
        case 'content':
          if (assistant.thinking && state.thinkStartedAt) {
            assistant.thinkElapsed = Math.max(1, Math.round((Date.now() - state.thinkStartedAt) / 1000));
            const t = $('.think', el);
            if (t && t.dataset.open === 'true') {
              t.dataset.open = 'false';
              $('.think-head', el).querySelector('.think-label').textContent = `已深度思考（用时 ${assistant.thinkElapsed} 秒）`;
            }
          }
          assistant.content = ev.mode === 'set' ? String(ev.v || '') : assistant.content + ev.v;
          break;
        case 'usage':
          assistant.usage = ev.v;
          break;
        case 'error':
          assistant.error = String(ev.v || '未知错误');
          break;
        case 'done':
          assistant.done = true;
          break;
        default:
          break;
      }
      paint();
    };

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
          try {
            handle(JSON.parse(payload));
          } catch {
            /* 忽略坏帧 */
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      assistant.stopped = true;
      if (!assistant.content) assistant.notice = '已停止生成';
    } else {
      assistant.error = String(err.message || err);
      assistant.notice = '';
    }
  } finally {
    assistant.streaming = false;
    if (!assistant.done && !assistant.error && !assistant.stopped) assistant.stopped = true;
    if (assistant.thinking && state.thinkStartedAt && !assistant.thinkElapsed) {
      assistant.thinkElapsed = Math.max(1, Math.round((Date.now() - state.thinkStartedAt) / 1000));
    }
    state.streaming = false;
    state.controller = null;
    setSendButton(false);
    paintMessage(el, assistant);
    touch(s);
    renderSidebar();
    const stick = nearBottom();
    if (stick) scrollToBottom();
  }
}

function stopStream() {
  const s = currentSession();
  state.controller?.abort();
  if (s?.webSessionId && state.settings.token) {
    fetch('/api/web/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deepseek-token': state.settings.token },
      body: JSON.stringify({ session_id: s.webSessionId, message_id: s.lastMessageId || null }),
    }).catch(() => {});
  }
}

function setSendButton(streaming) {
  dom.sendBtn.classList.toggle('streaming', streaming);
  dom.sendBtn.innerHTML = `<svg><use href="#i-${streaming ? 'stop' : 'send'}"/></svg>`;
  dom.sendBtn.title = streaming ? '停止生成' : '发送';
  dom.sendBtn.disabled = !streaming && !dom.input.value.trim();
}

function updateSendState() {
  dom.sendBtn.disabled = !state.streaming && !dom.input.value.trim();
}

function setProviderBadge(provider) {
  const p = provider || state.cfg.provider || 'mock';
  const label = p === 'api' ? 'API' : p === 'web' ? 'WEB' : 'MOCK';
  dom.providerBadge.textContent = label;
  dom.providerBadge.classList.toggle('api', p === 'api' || p === 'web');
  dom.providerSub.textContent =
    p === 'api' ? '官方 API 通道' : p === 'web' ? '官方 Web 会话通道' : '本地演示模式';
}

// ---------------------------------------------------------------- input
function autosize() {
  dom.input.style.height = 'auto';
  dom.input.style.height = Math.min(dom.input.scrollHeight, 200) + 'px';
}

function toggleTool(btn) {
  btn.dataset.on = btn.dataset.on === 'true' ? 'false' : 'true';
  if (btn === dom.searchBtn) {
    if (btn.dataset.on === 'true' && !state.cfg.search) {
      btn.dataset.on = 'false';
      toast('后端未启用检索（SEARCH_ENABLED=0）');
    }
  }
  if (btn === dom.thinkBtn) {
    dom.modelName.textContent = btn.dataset.on === 'true' ? 'DeepSeek (深度思考)' : 'DeepSeek';
  }
}

// ---------------------------------------------------------------- attachments
function renderAttachments() {
  const box = dom.attachments;
  if (!state.pendingFiles.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = state.pendingFiles
    .map(
      (f, i) =>
        `<span class="attach-chip"><b>${escapeHtml(f.name)}</b><i>${f.chars} 字</i>` +
        `<button type="button" data-rm="${i}" title="移除">×</button></span>`,
    )
    .join('');
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

async function uploadFiles(fileList) {
  for (const f of fileList) {
    try {
      toast(`解析 ${f.name}…`, 1200);
      const data = await readAsBase64(f);
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: f.name, data }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      state.pendingFiles.push({ name: j.name, chars: j.chars, text: j.text });
      renderAttachments();
      if (j.truncated) toast(`${f.name} 过长，已截断到 200k 字符`);
    } catch (e) {
      toast(`${f.name} 解析失败：${e.message}`, 3200);
    }
  }
}

// ---------------------------------------------------------------- events
function bind() {
  $('#newChatBtn').addEventListener('click', () => {
    const s = currentSession();
    if (s && !s.messages.length) return dom.input.focus();
    newSession();
  });

  $('#brandBtn').addEventListener('click', () => {
    state.currentId = null;
    renderSidebar();
    renderThread();
    dom.input.focus();
  });

  dom.convList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) return deleteSession(del.dataset.del);
    const item = e.target.closest('.conv-item');
    if (item) openSession(item.dataset.id);
  });

  $('#collapseBtn').addEventListener('click', () => {
    dom.app.classList.toggle('sidebar-collapsed');
    dom.app.classList.remove('sidebar-open');
  });

  $('#menuBtn').addEventListener('click', () => {
    dom.app.classList.add('sidebar-open');
    dom.scrim.classList.add('show');
  });
  dom.scrim.addEventListener('click', closeSidebar);

  $('#themeBtn').addEventListener('click', cycleTheme);

  $('#shareBtn').addEventListener('click', async () => {
    const s = currentSession();
    if (!s || !s.messages.some((m) => m.role === 'assistant' && m.content)) {
      return toast('当前会话还没有可分享的回答');
    }
    try {
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: { title: s.title, messages: s.messages } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const url = new URL(j.url, location.origin).href;
      try {
        await navigator.clipboard.writeText(url);
        toast('分享链接已复制');
      } catch {
        toast(url, 4000);
      }
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast(`分享失败：${e.message}`);
    }
  });

  dom.thinkBtn.addEventListener('click', () => toggleTool(dom.thinkBtn));
  dom.searchBtn.addEventListener('click', () => toggleTool(dom.searchBtn));
  dom.attachBtn.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', async () => {
    const files = [...dom.fileInput.files];
    dom.fileInput.value = '';
    if (files.length) await uploadFiles(files);
  });
  dom.attachments.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    state.pendingFiles.splice(Number(rm.dataset.rm), 1);
    renderAttachments();
  });

  dom.sendBtn.addEventListener('click', () => send());

  dom.input.addEventListener('input', () => {
    autosize();
    updateSendState();
  });
  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  $('#suggest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-prompt]');
    if (!b) return;
    dom.input.value = b.dataset.prompt;
    autosize();
    send();
  });

  dom.messages.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const code = copy.closest('.code-block')?.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        copy.querySelector('span').textContent = '已复制';
        setTimeout(() => (copy.querySelector('span').textContent = '复制'), 1500);
      } catch {
        toast('复制失败（浏览器拒绝剪贴板）');
      }
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const msgEl = e.target.closest('.msg.assistant');
    const s = currentSession();
    const msg = s?.messages.find((m) => m.id === msgEl?.dataset.id);
    if (!msg) return;

    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(msg.content);
        toast('已复制回答');
      } catch {
        toast('复制失败');
      }
    } else if (act === 'regen') {
      if (state.streaming) return toast('正在生成中');
      const idx = s.messages.indexOf(msg);
      s.messages = s.messages.slice(0, idx);
      write(LS.sessions, state.sessions);
      renderThread();
      const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        s.messages = s.messages.filter((m) => m !== lastUser);
        write(LS.sessions, state.sessions);
        renderThread();
        send(lastUser.content);
      }
    } else if (act === 'tts') {
      const synth = window.speechSynthesis;
      if (!synth) return toast('当前浏览器不支持语音合成');
      if (synth.speaking) {
        synth.cancel();
        toast('已停止朗读');
        return;
      }
      const u = new SpeechSynthesisUtterance(msg.content.replace(/```[\s\S]*?```/g, '（代码块）').slice(0, 4000));
      u.lang = 'zh-CN';
      u.rate = 1.02;
      synth.speak(u);
      toast('开始朗读，再点一次停止');
    } else if (act === 'like' || act === 'dislike') {
      const other = act === 'like' ? 'dislike' : 'like';
      const btn = e.target.closest('[data-act]');
      const wasOn = btn.classList.contains('on');
      $$(`[data-act="${act}"], [data-act="${other}"]`, msgEl).forEach((b) => b.classList.remove('on'));
      if (!wasOn) btn.classList.add('on');
      toast(act === 'like' ? (wasOn ? '已取消' : '感谢反馈') : wasOn ? '已取消' : '已记录，会反馈给模型侧');
    }
  });

  dom.messages.addEventListener('click', (e) => {
    const head = e.target.closest('.think-head');
    if (!head) return;
    const box = head.closest('.think');
    box.dataset.open = box.dataset.open === 'true' ? 'false' : 'true';
  });

  // settings
  const openSettings = () => {
    $('#apiKeyInput').value = state.settings.key || '';
    $('#baseInput').value = state.settings.base || '';
    $('#tokenInput').value = state.settings.token || '';
    $('#channelSelect').value = state.settings.channel || 'auto';
    dom.settingsModal.showModal();
  };
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsBtn2').addEventListener('click', openSettings);

  dom.settingsModal.addEventListener('close', () => {
    if (dom.settingsModal.returnValue !== 'save') return;
    state.settings = {
      key: $('#apiKeyInput').value.trim(),
      base: $('#baseInput').value.trim(),
      token: $('#tokenInput').value.trim(),
      channel: $('#channelSelect').value,
    };
    write(LS.settings, state.settings);
    setProviderBadge(resolveChannel());
    const msg =
      state.settings.channel === 'web'
        ? state.settings.token
          ? '已保存：走官方 Web 会话通道'
          : 'Web 通道还缺 userToken'
        : state.settings.channel === 'api'
          ? state.settings.key
            ? '已保存：走官方 API'
            : 'API 通道还缺 Key'
          : '已保存';
    toast(msg);
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sessions: state.sessions }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deepseek-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#clearBtn').addEventListener('click', () => {
    if (!confirm('清空所有本地会话？此操作不可撤销。')) return;
    state.sessions = [];
    state.currentId = null;
    write(LS.sessions, state.sessions);
    renderSidebar();
    renderThread();
    toast('已清空');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  applyTheme();
  setSendButton(false);
  bind();

  try {
    const r = await fetch('/api/config');
    state.cfg = await r.json();
  } catch {
    /* 保持默认 */
  }
  setProviderBadge(resolveChannel());

  state.currentId = state.sessions[0]?.id || null;
  renderSidebar();
  renderThread();
  autosize();
  updateSendState();
}

boot();
