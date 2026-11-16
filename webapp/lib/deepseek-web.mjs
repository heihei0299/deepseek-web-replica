// deepseek-web.mjs — 官方 Web 会话通道（/api/v0/*）
// 协议来自 docs/web-analysis.md：token + PoW 挑战头 + SSE 路径补丁。

const BASE = (process.env.DS_WEB_BASE || 'https://chat.deepseek.com').replace(/\/+$/, '');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function headers(token, extra = {}) {
  return {
    'content-type': 'application/json',
    accept: '*/*',
    authorization: `Bearer ${token}`,
    'user-agent': UA,
    origin: BASE,
    referer: `${BASE}/`,
    'x-client-platform': 'web',
    'x-client-version': '1.0.0',
    'x-client-locale': 'zh_CN',
    'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
    'x-client-bundle-id': 'com.deepseek.chat',
    ...extra,
  };
}

async function post(token, path, body, extraHeaders = {}, signal) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    signal,
    headers: headers(token, extraHeaders),
    body: JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} 返回非 JSON（HTTP ${r.status}）: ${text.slice(0, 200)}`);
  }
  if (json.code !== 0) {
    const hint =
      json.code === 40003
        ? 'token 无效或过期，请在设置里更新 userToken'
        : json.code === 40002
          ? '缺少 token'
          : json.msg || '请求失败';
    const err = new Error(`${hint}（code=${json.code}）`);
    err.code = json.code;
    throw err;
  }
  return json.data;
}

export async function createSession(token) {
  const data = await post(token, '/api/v0/chat_session/create', {});
  return data?.biz_data?.chat_session?.id || data?.chat_session?.id || null;
}

export async function createPowChallenge(token, targetPath) {
  const data = await post(token, '/api/v0/chat/create_pow_challenge', { target_path: targetPath });
  const ch = data?.biz_data?.challenge;
  if (!ch) throw new Error('挑战响应缺少 challenge');
  return ch;
}

export async function stopStream(token, chatSessionId, messageId) {
  return post(token, '/api/v0/chat/stop_stream', {
    chat_session_id: chatSessionId,
    message_id: messageId,
  }).catch(() => null);
}

export async function fetchHistory(token, chatSessionId) {
  return post(token, '/api/v0/chat/history_messages', {
    chat_session_id: chatSessionId,
    cache_version: 0,
  }).catch(() => null);
}

/** 把 {p,o,v} 路径补丁应用成文本增量 */
function applyDelta(state, d, emit) {
  const path = d.p || state.lastPath || '';
  const op = d.o || (state.lastOp ?? 'APPEND');
  state.lastPath = path;
  state.lastOp = op;

  if (op === 'BATCH' && Array.isArray(d.v)) {
    for (const item of d.v) applyDelta(state, { ...item, p: path ? `${path}/${item.p || ''}` : item.p }, emit);
    return;
  }

  const isThinking = /think/i.test(path);
  const cur = state.text[path] || '';

  if (op === 'APPEND') {
    const v = typeof d.v === 'string' ? d.v : d.v == null ? '' : String(d.v);
    if (!v) return;
    state.text[path] = cur + v;
    emit({ type: isThinking ? 'thinking' : 'content', v });
    return;
  }

  // SET：整体替换
  if (typeof d.v === 'string') {
    state.text[path] = d.v;
    emit({ type: isThinking ? 'thinking' : 'content', mode: 'set', v: d.v });
  }
}

/**
 * 发起补全并归一化上游事件。
 * onEvent: ({type:'content'|'thinking'|'title'|'notice'|'error'|'done'|'meta', ...}) => void
 */
export async function streamChat(token, body, { powHeader, signal, onEvent }) {
  const r = await fetch(`${BASE}/api/v0/chat/completion`, {
    method: 'POST',
    signal,
    headers: headers(token, {
      accept: 'text/event-stream',
      ...(powHeader ? { 'x-ds-challenge-response': powHeader } : {}),
    }),
    body: JSON.stringify(body),
  });

  const ctype = r.headers.get('content-type') || '';
  if (!ctype.includes('text/event-stream')) {
    const text = await r.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.msg || JSON.stringify(j);
      if (j.code === 40003) msg = 'token 无效或过期';
    } catch {}
    throw new Error(`上游未返回流（HTTP ${r.status}）: ${msg.slice(0, 300)}`);
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  const state = { text: {}, lastPath: '', lastOp: 'APPEND' };
  let buf = '';
  let eventName = '';
  let finished = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let dataLines = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        else if (line.startsWith(':')) continue;
      }
      if (!dataLines.length) continue;
      const payload = dataLines.join('\n');
      if (payload === '[DONE]') {
        finished = true;
        onEvent({ type: 'done', v: { finish: 'stop' } });
        continue;
      }

      let ev;
      try {
        ev = JSON.parse(payload);
      } catch {
        continue;
      }

      switch (eventName) {
        case 'ready':
          onEvent({ type: 'meta', v: { ready: true } });
          break;
        case 'delta':
          applyDelta(state, ev, onEvent);
          break;
        case 'title':
          onEvent({ type: 'title', v: ev?.content || ev?.title || '' });
          break;
        case 'toast':
          onEvent({ type: 'notice', v: ev?.content || '' });
          break;
        case 'hint':
          if (ev?.content) onEvent({ type: 'notice', v: ev.content });
          if (ev?.finish_reason) onEvent({ type: 'meta', v: { finish_reason: ev.finish_reason } });
          break;
        case 'finish':
          finished = true;
          onEvent({ type: 'done', v: { finish: ev?.finish_reason || 'stop' } });
          break;
        case 'close':
          if (!finished) onEvent({ type: 'done', v: { finish: 'close' } });
          finished = true;
          break;
        default:
          if (ev && (ev.p || ev.o || ev.v)) applyDelta(state, ev, onEvent);
          break;
      }
    }
  }

  if (!finished) onEvent({ type: 'done', v: { finish: 'eof' } });
  return { text: state.text };
}
