# 目标画像：com.deepseek.chat

## 制品

| 项 | 值 | 来源 |
| --- | --- | --- |
| 文件 | `artifacts/deepseek.apk` | `https://download.deepseek.com/apk/deepseek.apk` |
| 大小 | 22,296,584 B | `ls -l` |
| SHA-256 | `489ff75c6debfce94fcb247595969b71314522c736b11548eb27c845a5f4dce4` | `sha256sum` |
| 包名 | `com.deepseek.chat` | REA `inspect-android-package` |
| versionName | 2.8.0 | 同上 |
| versionCode | 297 | 同上 |
| minSdk / targetSdk | 24 / 36 | 同上 |
| 资源条目 | 1007 | 同上 |

Evidence：`evidence/20261116-221750-package.json`
（`evidence_id: ev_f6abf24b…c67287e57c`，provider `jadx-headless-mcp 0.7.1`）

## 结构

- 3 个 DEX：`classes.dex` 12.68 MB、`classes3.dex` 2.81 MB、`classes2.dex` 0.26 MB。
- 无 `lib/` 原生主逻辑以外的特殊包；含 Flutter 之外的标准 Android 组件。
- **R8 混淆**：13996 个类中仅 24 个保留 `com.deepseek.*` 原名（都是 manifest/组件入口），
  其余全部落到 `defpackage.a`、`defpackage.a0` 之类短名
  （Evidence：`evidence/20261116-221926-classes-all.json`）。
  → **按类名检索无效，必须靠字符串锚点 + 反编译代码追踪。**

## 网络面（DEX 字符串层观察）

| 用途 | 值 |
| --- | --- |
| 主站 | `https://chat.deepseek.com` |
| 静态/CDN | `https://cdn.deepseek.com`、`https://static.deepseek.com` |
| 聊天补全 | `/api/v0/chat/completion` |
| 消息反馈 | `/api/v0/chat/message_feedback` |
| 客户端配置 | `/api/v0/client/settings`、`/api/v0/client/settings/report` |
| 遥测 | `/api/v0/telemetry` |
| 三方 APM | `apmplus.volces.com`、`gator.volces.com`（字节 APM+） |

## 提示词相关实体（Kotlin metadata 字符串）

```
com.deepseek.chat.settings.ModelConfig
com.deepseek.chat.settings.ModelConfig.CallFeature
com.deepseek.chat.settings.ModelConfig.FileFeature
com.deepseek.chat.settings.ModelConfig.PromptTemplate          <-- 客户端“提示词”载体
com.deepseek.chat.settings.ModelConfig.PromptTemplate.Scene    <-- 场景枚举
com.deepseek.chat.settings.ModelConfig.RegenerateOption
com.deepseek.chat.settings.ModelConfig.SearchFeature
com.deepseek.chat.settings.ModelConfig.ThinkFeature
com.deepseek.chat.settings.ModelConfig.Tips
com.deepseek.chat.settings.ModelConfig.TtsFeature
com.deepseek.chat.settings.ProviderConfig
com.deepseek.chat.settings.WelcomeMsgConfig
com.deepseek.chat.settings.BannerConfig
```

生成自 data class `toString()` 的常量：
`ModelConfig(type=…)`、`PromptTemplate(id=…)`、`Scene(value=…)`。

UI 层（Compose，保留源码文件名注释）：
`ui.pages.chat.session.input.prompt.PromptTemplateSection`（`PromptTemplateSection.kt:47`）、
`PromptTemplateView`（`PromptTemplateView.kt:138`）、`PromptFeatureChip`。

## 初步判断

- “提示词”在该客户端里指的是**输入区展示的提示词模板卡片**（id/title/scene），
  由 `/api/v0/client/settings` 下发的 `ModelConfig.PromptTemplate` 驱动，点击后填充输入框。
- 中文系统提示词（“你是…”“助手…”）在 DEX 字符串池中计数为 0，
  与“system prompt 由服务端在 `/api/v0/chat/completion` 内部拼接”一致。
  **待代码层复核（见 ledger 待验证队列）。**
