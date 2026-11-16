# 环境与工具链

全部装在 `.tools/`（不入版本库），不动系统全局。

| 组件 | 版本 | 位置 | 校验 |
| --- | --- | --- | --- |
| REA CLI | 6.8.0 | `rea`（PATH 内） | — |
| JDK | Temurin 21.0.13+9 LTS | `.tools/jdk` | 含 `jdk.compiler`（JADX 要求） |
| jadx-headless-mcp | 0.7.1 | `.tools/android/jadx-headless-mcp-0.7.1-all.jar` | SHA-256 `6e5eacf5…73ff75` ✔ |
| apktool | 2.11.1 | `.tools/apktool` + `.tools/apktool.jar` | — |
| jadx (独立 CLI) | 1.5.6 | `.tools/jadx` | 用于全量反编译 |
| Python | 3.14.10 | 系统 | 跑 `scripts/dexstrings.py` |

## 环境变量

```bash
export JAVA_HOME="$PWD/.tools/jdk"
export REA_JADX_MCP_JAR="$PWD/.tools/android/jadx-headless-mcp-0.7.1-all.jar"
export REA_APKTOOL_COMMAND="$PWD/.tools/apktool"
```

`scripts/rea-android.sh` 已内置这三个默认值，直接跑即可。

## 复现命令

```bash
bash scripts/deps.sh                      # 下载并校验 JDK + JADX（幂等）
bash scripts/rea-android.sh doctor        # 检查 JADX provider 是否就绪
bash scripts/rea-android.sh package       # 包身份/清单/组件 → evidence/
bash scripts/rea-android.sh resources     # apktool 解码字符串表
sed -n '1,40p' artifacts/unpacked/sources/sources/defpackage/ql7.java
```

## 已知限制

- REA 的 `--locale` 取值要写成 **`b+zh+Hans`**（带 BCP-47 修饰符），
  写 `zh` 会得到 0 条（该 APK 没有 `values-zh`，只有 `values-b+zh+Hans`）。
- `inspect-android-package` 只解码声明层，不做代码执行；
  类名/方法级结论一律走 `search-android-classes` → `inspect-android-class` → `inspect-android-method`。
- 混淆包里 `search-android-classes` 对业务类名基本无效，字符串锚点才是入口。
