# DeepSeek App 提示词逆向工作区

对 DeepSeek 做静态逆向：官方 Android 客户端 `com.deepseek.chat` 的**提示词实现**，
以及官方 Web 端 `chat.deepseek.com` 的**网络协议与流式格式**。
逆向结论已用于复刻一个可运行的网页版（`webapp/`）。

## 当前状态

| 项 | 值 |
| --- | --- |
| 目标包 | `com.deepseek.chat` |
| 版本 | 2.8.0（versionCode 见 `artifacts/`） |
| APK | `artifacts/deepseek.apk`（22,296,584 B） |
| SHA-256 | `489ff75c6debfce94fcb247595969b71314522c736b11548eb27c845a5f4dce4` |
| 来源 | `https://download.deepseek.com/apk/deepseek.apk` |
| 已做 | 取下 APK、包身份/清单、DEX 字符串全量解析、全量反编译（13991 个 .java）、请求体模型定位、内置提示词还原 |
| Web 端 | `main.ada2c4f5c4.js` 1.66 MB + `main.css` 303 KB + PoW worker，36 个 `/api/v0/*` 端点到手 |
| 复刻 | `webapp/`：零依赖 Node 后端 + 原生前端；三条通道（本地演示 / 官方 API / 官方 Web 会话） |

### 核心结论

1. **客户端没有系统提示词。** DEX 字符串池与 13991 个反编译源码里，“你是 / 助手 / 你是一个 /
   Role: / You are a” 计数全为 0；请求体 `ChatFullCompletionRequest` 只有 `prompt`（用户文本）
   + `chat_session_id / parent_message_id / thinking_enabled / search_enabled / model_type / action`，
   没有 `messages`、没有 `system` 角色。
2. **App 里的“提示词”是输入区建议 chip。** `ModelConfig.PromptTemplate{id, scene, content}`
   由 `/api/v0/client/settings` 下发，本地另带 16 条兜底文案（分析一下 / 答案是什么 / 怎么办 /
   解释一下 / 总结 / 这是什么），点击只填输入框、不发送。
3. **Web 端同样不拼装 system 提示词。** `role:"system"` 命中 0，请求体只有 `prompt` +
   `chat_session_id`，上下文与身份指令都在服务端。
4. **Web 流式不是整段文本，而是路径补丁。** SSE 事件 `ready/delta/title/finish/hint/close…`，
   `delta = {p, o, v}`，`o ∈ SET|BATCH|APPEND`，逐字输出就是向
   `response/fragments/<i>/content` 追加。
5. **PoW 挑战**：`/api/v0/chat/create_pow_challenge` → `sha3` wasm worker 求解 →
   `x-ds-challenge-response: base64(JSON)` 回填。
6. 详细结论见 `findings/ledger.md`、`docs/web-analysis.md`，模板清单见
   `findings/prompts/client-prompt-templates.md`。

## 复刻的网页版

```bash
cd webapp
node server.mjs                       # http://127.0.0.1:8787，默认本地演示模式
DEEPSEEK_API_KEY=sk-xxx node server.mjs   # 接官方 API
```

界面按官方设计令牌（`--dsw-*`）还原：侧栏会话、深度思考折叠块、联网搜索来源卡、
流式 Markdown、代码块复制、深浅色、移动端抽屉。协议差异见 `docs/web-analysis.md`
末尾的映射表。

## 快速开始（逆向侧）

```bash
# 1) 本地工具链（首次）
bash scripts/deps.sh

# 2) 环境
export JAVA_HOME="$PWD/.tools/jdk"
export REA_JADX_MCP_JAR="$PWD/.tools/android/jadx-headless-mcp-0.7.1-all.jar"

# 3) 包身份 / 清单 / 资源
bash scripts/rea-android.sh package

# 4) 字符串层扫描（不依赖 Java）
python3 scripts/dexstrings.py artifacts/deepseek.apk --grep -i 'prompt|template|system' --out evidence/
```

## 目录

| 路径 | 用途 |
| --- | --- |
| `artifacts/` | 原始 APK 与哈希；解包产物 |
| `evidence/` | REA Evidence、命令输出、抓包 |
| `findings/ledger.md` | 结论台账（观察/推断/未知） |
| `findings/prompts/` | 逐条提示词或模板 |
| `docs/` | 目标画像、方法论、分类、环境 |
| `scripts/` | 可复现脚本（`web-fetch.sh` 抓 web 制品、`web-surface.sh` 导出网络面） |
| `webapp/` | 网页版复刻（前后端 + 预览图 + README） |
| `reverse/web/` | web 前端制品（gitignore，可用脚本重抓） |
| `.tools/` | JDK/JADX/apktool（gitignore） |

## 下一步

见 `findings/ledger.md` 末尾的“待验证队列”。

## 复刻版 `webapp/`（v1.1）

| 能力 | 状态 |
| --- | --- |
| 官方 Web 会话通道 | `/api/v0` 全链路：`create_pow_challenge` → 官方 worker 求 PoW → `x-ds-challenge-response` → `chat/completion` `{p,o,v}` 解析 → `stop_stream`。需要自己的 `userToken` |
| 官方 API 通道 | `chat/completions`，`reasoning_content` → 思考块 |
| 本地演示 | 无网络也能跑通流式 / 思考 / 停止 / Markdown |
| 附件 | txt/md/json/csv/代码、docx、xlsx、pdf、zip 文本提取，注入上下文 |
| 联网搜索 | Bing RSS → DuckDuckGo 兜底，来源卡片 |
| 分享 | `POST /api/share` → 只读页 `/s/<id>` |
| TTS | 浏览器语音合成朗读回答 |

细节与配置见 `webapp/README.md`，协议依据见 `docs/web-analysis.md`。
