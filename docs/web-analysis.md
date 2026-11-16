# web 端逆向记录：chat.deepseek.com

目标：拿到官方 Web 客户端的**网络协议、流式格式、功能开关与设计令牌**，
作为「复刻一个网页版」的依据。全部为静态观察，未登录、未发真实对话请求。

证据文件：`evidence/20261116-225746-web-surface.txt`（由 `scripts/web-surface.sh` 生成）。

---

## O-01 制品与抓取条件

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `index.html` | 8,621 B | `28e965f2…a0ccdcc` |
| `main.ada2c4f5c4.js` | 1,663,092 B | `799ca4fd…5db76df` |
| `default-vendors.a63ee0213e.js` | 1,036,881 B | — |
| `main.dc093a796f.css` | 303,171 B | `1b7a12c9…90ccfbc` |
| `pow-worker`（chunk 37627） | 37,982 B | `a28a183c…cf12ea0` |

- 资源域名：`fe-static.deepseek.com/chat/static/`，`<script>` 带 SRI `integrity`。
- **裸 curl 首次返回 429**（华为 WAF，`block-event-id`）；带常规桌面 UA 后 200。
  说明 WAF 判别粒度包含 UA/指纹，不是纯 IP 封禁。
- 页面是 SPA，HTML 只有壳；逻辑全在 `main.*.js`（1.66 MB，单行压缩）。

## O-02 接口面（36 个 `/api/v0/*` 字面量）

```
auth/ticket                      chat/completion               chat/continue
chat/create_pow_challenge        chat/edit_message             chat/history_messages
chat/message_feedback            chat/regenerate               chat/resume_stream
chat/status                      chat/stop_stream              chat/tts/{voice,voices}
chat_session/{create,delete,delete_all,fetch_page,update_title,batch_update_pinned}
client/{settings,settings/report,span,wechat_js_sdk_signature}
download_export_history          export_all                    file/{upload_file,fetch_files,fork_file_task}
index/{prepare,query}            share/{content,create,delete,fork,list}
telemetry                        users + users/{settings,create_*_verification_code,create_guest_challenge,…}
```

与 APK（`com.deepseek.chat` 2.8.0）的端点集合**基本同构**，Web 端多出分享、导出、TTS、索引、微信 SDK；
两端都没有「客户端自带 system 消息」的字段。

## O-03 客户端自有请求头

`x-client-bundle-id`（品牌标识）、`x-client-platform`、`x-client-version`、`x-client-locale`、
`x-client-timezone-offset`、`x-device-id`、`x-ds-trace-id`、`x-ds-compression`、
`x-settings-token`、`x-model-type`、`x-thinking-enabled`、`x-request-encryption-key`、
`x-ds-challenge-response`、`x-hif-dliq / -leim / -ttl`（A/B 实验分流）。

构造位置（`main.ada2c4f5c4.js` @1424377）：

```js
{"x-client-bundle-id": HP(brand), "x-client-platform": platform,
 "x-client-version": version, "x-client-locale": locale,
 "x-client-timezone-offset": tzOffsetSeconds}
```

## O-04 工作量证明（PoW）

流程（观察）：

1. `POST /api/v0/chat/create_pow_challenge`，体 `{target_path}`；`target_path` 取被保护接口，
   例如 `/api/v0/chat/completion`、`/api/v0/file/upload_file`（@446193）。
2. 响应 `biz_data.challenge` 字段：`algorithm`（`DeepSeekHashV1`）、`challenge`、`salt`、
   `difficulty`、`signature`、`expire_at`、`expire_after`。
3. 求解在 Web Worker 中完成（chunk 37627，配 `sha3_wasm_bg.7b9ca65ddd.wasm`）：

```js
let prefix = `${salt}_${expireAt}_`;
n.wasm_solve(challenge, prefix, difficulty)   // 返回 number 解；0 视为无解
```

4. 回填请求头（@1392369 / @1414213）：

```js
[ "x-ds-challenge-response",
  btoa(JSON.stringify({ algorithm, challenge, salt, answer, signature, target_path })) ]
```

5. 业务请求被 405/202/403/429 且带 `x-amzn-waf-action` / `cf-mitigated` 时走 retry + 重新挑战
   （`onBeforeReplay` 注入新头）。

**未验证**：`wasm_solve` 内部哈希细节与 `difficulty` 的数值语义（计数阈值还是前导零位数）。
wasm 是编译产物，静态可读性低；要落定必须实际跑一次挑战并校验，本工作区没有账号，未做。

## O-05 补全请求体（Web 与 APK 同构）

```js
{ chat_session_id, parent_message_id, model_type, prompt, ref_file_ids,
  thinking_enabled, search_enabled, source, action, preempt }
```

其他分支（@920101）：

| 场景 | 体字段 |
| --- | --- |
| regenerate | `chat_session_id, child_message_id, search_enabled, thinking_enabled, user_options` |
| continue | `chat_session_id, message_id, fallback_to_resume` |
| editMessage | `chat_session_id, message_id, ref_file_ids, prompt, search_enabled, thinking_enabled, action` |
| resumeStream | `chat_session_id, message_id` |

没有 `messages[]`、没有 `system` 角色 —— **上下文由服务端按 session + parent_message_id 还原**。

## O-06 流式响应：事件 + delta 补丁

事件枚举（@1336729）：

```
ready · delta · toast · title · finish · close · hint
updateSession · updateParentMessage · updateFile
```

`delta` 的负载是「路径补丁」，不是整段文本（@904108 / @905185）：

```js
{ p: "response/fragments/0/content", o: "SET" | "APPEND" | "BATCH", v: any }
// BATCH: v 是同类 op 的数组，子路径拼在父 p 之后
// 解析器默认 op = "SET"、默认 path = ""，两者都可跨帧继承
```

渲染侧把 path 逐段应用到消息树，`APPEND` 到 `response/fragments/<i>/content` 就是逐字输出；
`hint` 携带 `type(warning|error)`、`content`、`finish_reason`、`click_behavior(retry|none)`。

这意味着**不能用「每帧整段 JSON」的思维对接官方 web 通道**，必须实现路径补丁。

## O-07 功能开关来自服务端

`model_configs` 由 `/api/v0/client/settings` 下发（`getLatestFeature("model_configs")`，@29084），
字段含 `model_type / enabled / switchable`。模型名、可切换项、深度思考、联网、文件、TTS
都由 settings 决定 —— 与 APK 结论（F-008、F-011）一致：**客户端只是渲染器**。

## O-08 无客户端 system 提示词（关闭 V-006）

- `role:"system"` 命中 0；
- `"system"` 12+ 处均为无关词（settings/system message 等）；
- `You are a helpful` 命中 0，唯一的 `You are` 是英文 i18n 文案「You are sending messages too frequently…」；
- 请求体无 `messages[]`（O-05）。

结论：Web 端与 App 端一样，**不在客户端拼装 system prompt**，身份与约束在服务端补全链路注入。
要拿到文本只能靠行为侧探测，或服务端实现泄露 —— 静态分析到此为止。

## O-09 设计令牌（复刻 UI 的依据）

```css
--dsw-static-deepseek-500:#3964fe;  --dsw-static-deepseek-400:#679efe;
--dsw-static-deepseek-50:#edf3fe;   --dsw-static-deepseek-800:#34415b;
--dsw-static-neutral-bluish-00:#fff;    -50:#f9fafb;  -100:#ebeef2;
--dsw-static-neutral-bluish-600:#81858c; -700:#61666b; -1000:#0f1115;
--dsw-static-neutral-bluish-800:#353638; -850:#2c2c2e; -875:#232324;
--dsw-static-neutral-bluish-950:#151517;        /* 深色底 */
--dsw-alias-border-l2: rgba(0,0,0,.1) / rgba(255,255,255,.12)
--ds-font-family-code: Menlo, Monaco, Consolas, "JetBrains Mono", …
```

品牌蓝在投影/焦点环里写作 `#4d6bfe`，语义令牌给的是 `#3964fe`；复刻版两者都用，
主色取 `#4d6bfe`，hover/deep 用 `#3964fe`。字体栈 `Inter → system-ui → PingFang SC`。

---

## 复刻的技术选择

| 维度 | 官方 Web | 本复刻 | 原因 |
| --- | --- | --- | --- |
| 鉴权 | 登录 cookie/token + PoW + 数美设备号 | 官方 API Key（`Authorization: Bearer`） | 无账号授权，不复用他人会话 |
| 端点 | `/api/v0/chat/completion` | `api.deepseek.com/chat/completions` | 官方公开接口，OpenAI 兼容 |
| 上下文 | 服务端按 session 还原 | 客户端带 `messages[]` | 无服务端会话 |
| 流式 | SSE + `{p,o,v}` 路径补丁 | SSE + `{type,v}` 归一化事件 | 简化，但保留同一套语义（思考/正文分离、可中止、可续） |
| 思考 | `fragments` 里 `THINK` 片段 | `reasoning_content` 增量 | API 已分离该字段 |
| 检索 | 服务端内置搜索 | 后端 ddg/bing 检索 → 注入 system + 前端来源卡片 | 保持「先搜后答 + 引用」的形态 |
| 开关 | `/client/settings` 下发 | 前端本地 + `/api/config` | 无 settings 通道 |

事件映射：

```
官方 ready          → replica start  {provider, model}
官方 delta(p=…/content) → replica content {v}
官方 delta(p=…/thinking_content) → replica thinking {v}
官方 title          → 前端首条用户消息截断做标题
官方 hint/close     → replica error / done
```

## 复刻实现 v1.1（Web 通道落地）

`webapp/lib/deepseek-web.mjs` 按 O-04/O-05/O-06 实现，前端 PoW 直接用官方 worker 副本：

| 环节 | 实现 | 证据/备注 |
| --- | --- | --- |
| 挑战 | `POST /api/web/pow` → 上游 `create_pow_challenge`，`target_path=/api/v0/chat/completion` | 无 token 返回 `40002 Missing Token`，假 token 返回 `40003`（实测） |
| 求解 | `/static/pow-worker.js`（官方 chunk 37627）+ `8138.63461459c3.js` + `sha3_wasm_bg.7b9ca65ddd.wasm` | worker 运行时用 `importScripts` 加载 8138 chunk，classic worker（站点传 `type:void 0`） |
| 资源路径 | 把 `__webpack_require__.p` 由 `https://fe-static.deepseek.com/chat/` 改成 `/` | 否则 worker 跨域取 wasm，`Failed to fetch` |
| 回填 | `x-ds-challenge-response = base64(JSON{algorithm,challenge,salt,answer,signature,target_path})` | 与原实现同字段 |
| 会话 | 首条消息 `chat_session/create`，之后复用 `chat_session_id` | `start` 事件把 sessionId 回给前端保存 |
| 流式 | 解析 `event:` + `data:`，`{p,o,v}` 应用为 `thinking`/`content`；`SET` → 整体替换，`APPEND` → 增量 | `BATCH` 递归拼路径 |
| 停止 | `/api/v0/chat/stop_stream` | 中断时尽力调用 |

附件侧新增 `lib/extract.mjs`：文本/代码直读，docx 解 `word/document.xml`，xlsx 读 `sharedStrings.xml`，
PDF 解 `FlateDecode` 流并抽取括号字符串，zip 提取内部文本；上限 200k 字符。
分享侧 `POST /api/share` 落盘 `data/shares.json`，`/s/:id` 用同一套 Markdown 渲染器输出只读页。

## 仍未回答

1. `model_type` 的真实取值集合（服务端下发，静态不可见）。
2. PoW `wasm_solve` 的哈希语义与 `difficulty` 单位。
3. `shumei_device_id` 的校验强度（APK 侧 F-016 仍未关闭）。
4. `x-request-encryption-key` / `x-settings-token` 的具体用途与生效条件。
5. 202 风控页的触发阈值（会影响任何自动化抓取）。
