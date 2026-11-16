# 方法论

目标：回答“DeepSeek App 的提示词在哪、长什么样、怎么进到模型请求里”。

## 分层推进

1. **制品取证**（已完成）
   下载 → SHA-256 → REA `inspect-android-package` 拿包身份/清单/组件。
   证据：`evidence/20261116-221750-package.json`

2. **字符串层**（已完成初扫）
   `scripts/dexstrings.py` 解析 DEX `string_ids`（MUTF-8，含代理对处理），
   落盘全量字符串后按正则检索。
   ```bash
   python3 scripts/dexstrings.py artifacts/deepseek.apk --dump evidence/dex-strings-all.txt
   grep -a -i prompt evidence/dex-strings-all.txt
   ```
   作用：混淆包里的**唯一稳定锚点**。类名不可用，字符串可用。

3. **代码层**（全量反编译 + 定点追踪）
   ```bash
   .tools/jadx/bin/jadx -d artifacts/unpacked/sources --no-res --threads-count 4 artifacts/deepseek.apk
   ```
   追踪方式：用 `toString` 常量（`PromptTemplate(id=`）或日志/源码文件名注释
   （`PromptTemplateView.kt:341`）定位类，再沿构造函数调用链向上找解析入口
   （`/api/v0/client/settings` 响应模型），向下找使用点（点击 → 填充输入框 / 进入请求体）。

4. **请求构造层**
   找 `/api/v0/chat/completion` 的请求体类，确认字段集合：
   是否携带 `prompt` / `messages` / `system` 之类，还是只有 `prompt` + 若干布尔开关。
   这一步决定“客户端能否内嵌系统提示词”的结论。

5. **资源层**（按需）
   `bash scripts/rea-android.sh resources` → apktool 解码 `strings.xml`
   （多语言 UI 文案；用于区分“UI 文案”与“给模型的提示词”）。

6. **运行时层**（未做，需单独授权）
   HAR/SAZ 或真机抓包 → REA `inspect-web-network-capture`，
   观察 `/api/v0/chat/completion` 请求体是否真的只有用户输入。
   静态分析不能替代这一步。

## 证据规范

- 每个 REA 调用产出 `evidence/<时间戳>-<标签>.json`，保留原始 envelope。
- 结论写进 `findings/ledger.md`，标注 观察 / 推断 / 未知 与证据文件名。
- 反编译产物放 `artifacts/unpacked/sources`，可随时重生成，不入版本库。

## 陷阱

- **类名检索无意义**：13996 个类只有 24 个保留原名。
- **不要用 gzip 里的 strings 直接下结论**：DEX 是 MUTF-8，且字符串池含大量第三方 SDK
  （sqlite/antlr/volc APM）噪音，命中后必须回到代码确认调用点。
- Compose 的 `(Xxx.kt:行号)` 字符串是 R8 保留下来的**原始源码位置**，是最有价值的定位线索。
