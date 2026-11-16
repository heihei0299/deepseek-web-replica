# 结论台账

格式：`[ID] 类型 | 结论 | 证据`
类型：**观察** / **推断** / **未知**

---

## F-001 观察｜制品身份
APK = `com.deepseek.chat` v2.8.0 (versionCode 297)，minSdk 24 / targetSdk 36，
13996 个类、1007 个资源。
证据：`evidence/20261116-221750-package.json`（`ev_f6abf24b…`）、`artifacts/deepseek.apk.sha256`

## F-002 观察｜代码被 R8 混淆
13996 个类里只有 24 个保留 `com.deepseek.*` 全名（均为 manifest 组件入口），
其余为 `defpackage.a` / `defpackage.a0` 等短名。
证据：`evidence/20261116-221926-classes-all.json`；`rea search-android-classes <apk> Prompt` 命中 0。

## F-003 观察｜提示词相关数据模型存在
Kotlin metadata 字符串中存在
`com.deepseek.chat.settings.ModelConfig.PromptTemplate` 及嵌套 `PromptTemplate.Scene`，
同级有 `CallFeature / FileFeature / SearchFeature / ThinkFeature / TtsFeature / Tips / RegenerateOption`。
证据：`evidence/dex-strings-all.txt` 第 43536–43539 行。

## F-004 观察｜提示词模板是 UI 组件
Compose 组件保留原始源码位置：
`PromptTemplateSection (PromptTemplateSection.kt:47)`、`PromptTemplateView (PromptTemplateView.kt:138)`、
`PromptFeatureChip (PromptTemplateView.kt:341)`。
证据：`evidence/dex-strings-all.txt` 第 44850–44854 行。

## F-005 观察｜请求端点
`/api/v0/chat/completion`、`/api/v0/chat/edit_message`、`/api/v0/chat/regenerate`、
`/api/v0/chat/continue`、`/api/v0/call/start`、`/api/v0/client/settings`、`/api/v0/telemetry`。
证据：`artifacts/unpacked/sources/sources/defpackage/oo3.java:8`

## F-006 观察｜DEX 无中文系统提示词
全量字符串池中 `你是 / 助手 / 提示词 / 你是一个 / Role: / You are a / As an AI` 计数均为 0；
ADB 反编译源码中中文长字面量只有设置项说明、崩溃文案、ICP 备案号、TTS 参数说明。
证据：`evidence/dex-strings-all.txt` + `grep -rhoP '"[^"]*[\x{4e00}-\x{9fff}][^"]*"' sources/defpackage`

## F-007 观察｜PromptTemplate 结构
`defpackage/lk7.java`：`{int id, String scene, String content, Integer contentRes}`；
序列化器 `gk7.java` 只写 `id / scene / content`（`contentRes` 是本地兜底，不序列化）。
证据：`artifacts/unpacked/sources/sources/defpackage/lk7.java`、`gk7.java`

## F-008 观察｜16 条内置提示词模板
`defpackage/ql7.java` 静态初始化两组 `ModelConfig`（id 1–8 / 9–16），
scene ∈ {`image`, `file`}，文案为中文“分析一下 / 答案是什么 / 怎么办 / 解释一下 / 总结 / 这是什么”。
证据：`findings/prompts/client-prompt-templates.md`、`evidence/20261116-zh-hans-resources.json`

## F-009 观察｜补全请求体不含 system/messages
`com.deepseek.chat.network.chat.model.chat.ChatFullCompletionRequest` 字段：
`chat_session_id, parent_message_id, prompt, ref_file_ids, thinking_enabled,
search_enabled, audio_id, preempt, model_type, action, shumei_device_id`。
`ChatEditMessageRequest`：`chat_session_id, message_id, prompt, ref_file_ids,
thinking_enabled, search_enabled, client_stream_id, action, shumei_device_id`。
两者都只有用户文本 `prompt`，无 system 角色、无 messages 数组。
证据：`defpackage/wy1.java`、`defpackage/xx1.java`

## F-010 观察｜模板点击只填输入框
点击回调（`e17.java` ~11795）：埋点 `guide_prompt_click` → 记录
`key_prompt_template_click_history_<scene>` → `e17.T(...)` → 派发 `pq2(prompt)`
（`pq2.toString() = "Fork(prompt=…)"`）写入输入区，不直接发送。
证据：`defpackage/e17.java:11803-11849`、`defpackage/pq2.java`、`defpackage/f57.java:1063`

## F-011 推断｜真正的系统提示词在服务端
客户端既无内嵌 system prompt，请求体也不携带 system 字段，
故模型的身份/约束指令只能由服务端在补全链路注入。
**已用反证条件检验过**：全量源码无内嵌提示词常量（F-006），请求体无 system 字段（F-009）。
**仍属推断的部分**：服务端具体在哪一层拼接、是否随 model_type/action 变化——静态分析不可见。

## F-012 未知｜服务端注入细节
system prompt 原文、版本差异、`action` 取值语义（现有常量里可见 `chat/regenerate`、`chat/continue`、
`chat/edit_message` 等分支）、以及 `shumei_device_id`（数美风控）对会话的影响。
→ 需要运行时抓包（未授权，本工作区未做）。

## F-013 观察｜只信任系统 CA
`res/xml/network_security_config.xml`：`base-config` 仅 `<certificates src="system" />`；
`debug-overrides` 才含 user 证书，而包未声明 `android:debuggable`，该段不生效。
`usesCleartextTraffic="false"`（manifest），但 base-config 里 `cleartextTrafficPermitted="true"`。
证据：apktool 解码产物 `/tmp/dsdec/res/xml/network_security_config.xml`；REA manifest（`evidence/20261116-221750-package.json`）。

## F-014 观察｜无证书固定，无需 unpinning
全量反编译检索：`CertificatePinner` 0 处、`TrustManagerImpl` 0 处、`OkHostnameVerifier` 0 处；
`X509TrustManager` 11 处（第三方 SDK 常规实现）。
→ 证书进系统信任区即可解密，不需要额外绕过。

## F-015 观察｜移动端无 PoW 头
客户端自有头只有 `x-ds-compression`、`x-ds-served-by`、`x-ds-sse-heartbeat-timeout-secs`、`x-ds-trace-id`；
未发现 web 端那套 `x-ds-pow-response` 挑战流程。

## F-016 未知｜设备指纹校验强度
`ChatFullCompletionRequest.shumei_device_id` 在序列化描述里是**必填**
（`am8Var.j("shumei_device_id", false)`）。服务端是否强校验该值未知——
决定“能否脱离客户端直连 API”的关键。仅能由真实抓包/实测回答。

## F-017 推断｜抓包无法取得系统提示词
请求体无 system 消息（F-008）、SSE 只回 token 与检索片段，
故系统提示词不经过网络链路，抓包得不到文本；只能由行为侧探测（复述指令）间接获取。
**反证条件**：抓到任一响应中出现完整指令段（如 “You are DeepSeek…”）且非用户输入回显。

---

## 待验证队列（已处理）

- **V-001** `PromptTemplate` 字段与 `Scene` 取值 → 已答（F-007、F-008）
- **V-002** 补全请求体字段集合 → 已答（F-009）
- **V-003** 是否存在内嵌提示词常量 → 已答（F-006，全量扫描为 0）
- **V-004** 模板点击的数据流 → 已答（F-010）
- **V-005** 资源层是否有多行提示词文案 → 已答（`evidence/20261116-zh-hans-resources.json`，
  最长文案是欢迎语与免责声明，无指令型提示词）

## 新增待验证

- ~~V-006~~ Web 端 bundle 是否自带 system 段拼装 → **已答（F-022：未拼装）**
- **V-007** 抓包观察 SSE 请求/响应是否出现提示词痕迹（需账号与抓包授权）
---

# Web 端（chat.deepseek.com）

## F-018 观察｜web 制品与接口面
`main.ada2c4f5c4.js` 1,663,092 B（sha256 `799ca4fd…5db76df`）、`main.dc093a796f.css`
303,171 B、`pow-worker` 37,982 B；含 36 个 `/api/v0/*` 字面量，端点集合与 APK 同构，
Web 侧多出 share / export_all / tts / index。
证据：`evidence/20261116-225746-web-surface.txt` §1–2，`reverse/web/`

## F-019 观察｜PoW 协议
`POST /api/v0/chat/create_pow_challenge {target_path}` → `challenge{algorithm=DeepSeekHashV1,
challenge, salt, difficulty, signature, expire_at, expire_after}`；Worker 内
`wasm_solve(challenge, "${salt}_${expireAt}_", difficulty)`；回填
`x-ds-challenge-response: btoa(JSON.stringify({algorithm,challenge,salt,answer,signature,target_path}))`。
证据：`evidence/20261116-225746-web-surface.txt` §4–6

## F-020 观察｜补全请求体与 APK 一致
`chat_session_id, parent_message_id, model_type, prompt, ref_file_ids, thinking_enabled,
search_enabled, source, action, preempt`；regenerate/continue/edit/resume 各有独立字段集，
**均无 `messages[]`**。
证据：同上 §9（`main.ada2c4f5c4.js` @920101）

## F-021 观察｜流式是路径补丁而非整段文本
事件枚举 `ready/delta/toast/title/finish/close/hint/updateSession/updateParentMessage/updateFile`；
`delta` 负载 `{p,o,v}`，`o ∈ SET|BATCH|APPEND`，`BATCH` 子路径拼在父 `p` 之后，
`p`/`o` 可跨帧继承（解析器默认 `SET`/`""`）。
证据：同上 §7–8

## F-022 观察｜Web 端同样不拼装 system 提示词
`role:"system"` 命中 0；`You are a helpful` 命中 0；唯一 `You are` 是英文 i18n 文案；
请求体无 messages 数组。→ 与 F-011 一致，system 段由服务端补全链路注入。
证据：同上 §10

## F-023 观察｜模型与功能开关由服务端下发
`getLatestFeature("model_configs")` 取 `/api/v0/client/settings` 的 `model_configs`，
含 `model_type/enabled/switchable`；前端仅按配置渲染模型切换、深度思考、联网、文件、TTS。
证据：`main.ada2c4f5c4.js` @29084；同上 §2

## F-024 观察｜设计令牌
品牌 `--dsw-static-deepseek-500:#3964fe`，交互主色 `#4d6bfe`；中性蓝
`00:#fff / 50:#f9fafb / 700:#61666b / 1000:#0f1115`，深色底 `950:#151517`；
代码字体 `Menlo, Monaco, Consolas, "JetBrains Mono"…`。
证据：`main.dc093a796f.css`；同上 §11

## F-025 未知｜PoW 求解细节与风控参数
`wasm_solve` 内部哈希语义、`difficulty` 单位、`x-request-encryption-key` /
`x-settings-token` 用途、202 风控阈值，静态不可判定；需真实挑战应答或运行时观察。

## F-026 观察｜官方 PoW worker 的运行时依赖
worker chunk 37627 是 **classic worker**（站点 `new Worker(url,{type:void 0})`），
启动时用 `importScripts` 拉 chunk `8138.63461459c3.js`，再由 `__webpack_require__.p`
（`https://fe-static.deepseek.com/chat/`）拼 wasm 地址 `static/sha3_wasm_bg.7b9ca65ddd.wasm`。
把 `p` 改为 `/` 后可在本地同源运行。
证据：`webapp/public/static/pow-worker.js`（改前 sha256 `a28a183c…`，改后 `4d71e494…`）；
浏览器实测：未放 chunk 时 `importScripts` 报 `failed to load`，补齐后返回 `pow-error`（合成挑战无解）。

## F-027 观察｜复刻已落地 Web 通道，但未用真实账号验证
`webapp/lib/deepseek-web.mjs` 实现 `create_pow_challenge → worker 求解 → x-ds-challenge-response
→ /api/v0/chat/completion → {p,o,v} 解析 → stop_stream`。上游错误码已实测：
无 token `40002 Missing Token`、假 token `40003 Authorization Failed`。
端到端对话未验证（无账号），属 F-025 的延伸缺口。
