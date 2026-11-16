# deepseek-app-reverse — 工作区规则

## 目标
对 **DeepSeek 官方 Android 客户端**（`com.deepseek.chat`）做静态逆向，定位并还原其
**提示词相关实现**：内嵌模板、消息拼装逻辑、模型/端点选择、功能开关，以及哪些提示词
实际上由服务端下发。

## 事实纪律（强制）
每条结论必须可归类为以下三者之一，并在 `findings/ledger.md` 标注：

- **观察（observed）**：来自具体文件/字节/命令输出，附证据 ID、路径、行号或偏移。
- **推断（inferred）**：由观察推导，写清推导链与反证条件。
- **未知（unknown）**：当前证据无法回答，连同缺口一起记录。

禁止把静态观察说成运行时行为；禁止凭类名、字符串片段直接断言功能。

## 边界
- 只做**静态**分析，APK 不运行、不安装、不注入。
- 不绕过登录、风控、签名或付费；不伪造凭证。
- 抓包/运行时观察需单独授权后再做，并记录设备、版本、时间。
- 不修改 `artifacts/deepseek.apk`；所有派生产物写入其他目录。

## 目录
- `artifacts/` 不可变输入（APK、哈希、解包结果）
- `evidence/` REA Evidence 导出与命令输出
- `findings/` 结论台账与逐条提示词
- `docs/` 目标画像、方法论、分类框架
- `scripts/` 可复现脚本
- `.tools/` 本地工具链（JDK、JADX、apktool），不入库

## 工具
- REA CLI 6.8.0（`rea`）：`inspect-android-package` / `search-android-classes` /
  `inspect-android-class` / `inspect-android-method` / `trace-android-references` /
  `decode-android-resources`
- 前置：JDK 17+ 与 `jadx-headless-mcp-0.7.1-all.jar`，见 `docs/environment.md`
- 环境变量：`JAVA_HOME`、`REA_JADX_MCP_JAR`

## 工作方式
1. 先查既有 `findings/ledger.md` 与 `evidence/`，不重复分析。
2. 每个新结论先追加 ledger，再动下一步；结论变了就改条目不新增噪音。
3. 每次分析命令的完整输出落盘到 `evidence/`，文件名含命令与时间。
