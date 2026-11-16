# 客户端内置提示词模板（v2.8.0）

来源：`defpackage/ql7.java`（静态初始化块）＋ 资源表 `values-b+zh+Hans`。

## 数据结构

```java
// defpackage/lk7.java ← com.deepseek.chat.settings.ModelConfig.PromptTemplate
final class lk7 {
    int     a;  // id
    String  b;  // scene      （序列化为 Scene(value=…)）
    String  c;  // content    （服务端下发时使用）
    Integer d;  // contentRes （本地资源兜底，不参与序列化）
}
```

序列化器 `gk7.java` 只写 `id / scene / content` 三个字段 →
**服务端下发的模板只有文案字符串，没有额外指令**。

文案解析 `f57.java:1063`：

```java
static String z(lk7 t, Context ctx) {
    Integer r = t.contentRes;
    return (r == null || (s = ctx.getString(r)) == null) ? t.content : s;
}
```

即：本地兜底文案优先，否则用服务端下发的 `content`。

## 模板清单

| id | scene | 资源键 | 简体中文 | English |
| --- | --- | --- | --- | --- |
| 1 | image | `suggestion_prompt_analyze` | 分析一下 | Analyze |
| 2 | image | `suggestion_prompt_find_answer` | 答案是什么 | Find Answer |
| 3 | image | `suggestion_prompt_suggest_solution` | 怎么办 | Suggest a Solution |
| 4 | image | `suggestion_prompt_explain` | 解释一下 | Explain |
| 5 | file | `suggestion_prompt_analyze` | 分析一下 | Analyze |
| 6 | file | `suggestion_prompt_find_answer` | 答案是什么 | Find Answer |
| 7 | file | `suggestion_prompt_summarize` | 总结 | Summarize |
| 8 | file | `suggestion_prompt_explain` | 解释一下 | Explain |
| 9 | image | `suggestion_prompt_what_is_this` | 这是什么 | "What's This" |
| 10 | image | `suggestion_prompt_analyze` | 分析一下 | Analyze |
| 11 | image | `suggestion_prompt_suggest_solution` | 怎么办 | Suggest a Solution |
| 12 | image | `suggestion_prompt_explain` | 解释一下 | Explain |
| 13 | file | `suggestion_prompt_analyze` | 分析一下 | Analyze |
| 14 | file | `suggestion_prompt_find_answer` | 答案是什么 | Find Answer |
| 15 | file | `suggestion_prompt_summarize` | 总结 | Summarize |
| 16 | file | `suggestion_prompt_explain` | 解释一下 | Explain |

两组集合：`ql7.a`（id 1–8，通用模型配置）、`ql7.b`（id 9–16，另一套 ModelConfig 变体）。

## 点击后的行为

`e17.java` 内的点击回调（`~11795` 起）：

1. 埋点 `guide_prompt_click`：上报 `chat_session_id / model_type / file_source / guide_prompt_id / guide_prompt_text / rank`。
2. 本地记录 `key_prompt_template_click_history_<scene>`。
3. 调 `e17.T(g72, xm2, f57.z(template, ctx), ky1)` → 走 MVI 派发 `pq2(prompt)`
   （`pq2` 的 `toString` 为 `Fork(prompt=…)`），**把文案写进输入框**，不直接发送。

→ 客户端模板只是**输入建议**，与模型系统提示词无关。

## 复现

```bash
.tools/jadx/bin/jadx -d artifacts/unpacked/sources --no-res --threads-count 4 artifacts/deepseek.apk
sed -n '1,40p' artifacts/unpacked/sources/sources/defpackage/ql7.java
JAVA_HOME=.tools/jdk REA_APKTOOL_COMMAND=.tools/apktool rea decode-android-resources \
  artifacts/deepseek.apk --locale 'b+zh+Hans' --format json
```
