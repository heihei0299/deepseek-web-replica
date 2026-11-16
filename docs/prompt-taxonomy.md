# “提示词”在这个 App 里指什么

逆向前的关键问题：用户说的“提示词”可能是四种完全不同的东西。本工作区分别定位。

| 类型 | 定义 | 在客户端能否拿到 | 本仓库结论 |
| --- | --- | --- | --- |
| **系统提示词 / system prompt** | 决定模型身份、安全约束、输出风格的指令 | **不能**，客户端无内嵌 | 由服务端在 `/api/v0/chat/completion` 内部拼接（F-009） |
| **场景提示词模板** | 输入区下方可点的建议 chip | 能，但有服务端下发 + 本地兜底两条路 | `ModelConfig.PromptTemplate`，16 条内置兜底（`findings/prompts/client-prompt-templates.md`） |
| **功能引导文案** | 欢迎语、空态提示 | 能 | 资源表 `welcome_message_title_unified` = “今天有什么可以帮到你？” |
| **工具/联网子提示词** | 搜索、文件解析、语音通话内部指令 | 不能 | 端点 `/api/v0/call/start`、`/api/v0/chat/completion` 均由服务端接管 |

## 判断依据

- 请求模型 `ChatFullCompletionRequest` 字段（`defpackage/wy1.java`）：
  `chat_session_id, parent_message_id, prompt, ref_file_ids, thinking_enabled,
  search_enabled, audio_id, preempt, model_type, action, shumei_device_id`
  —— 只有用户文本 `prompt` 和一个 `action`，**没有 messages / system 数组**。
- `ChatEditMessageRequest`（`xx1.java`）同理。
- 全量 DEX 字符串与反编译源码中，中文第二人称指令（“你是…”“你是一个…”）计数为 0；
  英文 `You are` / `System:` 常量同样为 0。

## 因此，要拿到真正的系统提示词

只有三条路，且都不在 APK 里：

1. **抓包**：登录后抓 `/api/v0/chat/completion` 的 SSE 响应与请求
   （REA `inspect-web-network-capture`，需 HAR/SAZ 与账号授权）。
   注意：系统提示词通常在服务端注入，**未必出现在任何报文里**。
2. **Web 前端**：`chat.deepseek.com` 的 bundle（REA `analyze-web-bundle`），
   看前端是否自行拼装 system 段。
3. **行为侧**：通过模型输出反推约束（属模型行为测量，不是逆向客户端）。
