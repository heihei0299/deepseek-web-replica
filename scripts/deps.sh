#!/usr/bin/env bash
# 本地工具链准备（只装到 .tools/，不动系统）
set -euo pipefail
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$WS/.tools"
JADX_JAR="$TOOLS/android/jadx-headless-mcp-0.7.1-all.jar"
JADX_SHA="6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75"
JDK_URL="https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
JADX_URL="https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar"

mkdir -p "$TOOLS/android"

if [[ ! -x "$TOOLS/jdk/bin/javac" ]]; then
  echo "[deps] 下载 JDK 21 ..."
  curl -fL --retry 3 -o "$TOOLS/jdk.tar.gz" "$JDK_URL"
  rm -rf "$TOOLS/jdk-extract"; mkdir -p "$TOOLS/jdk-extract"
  tar -xzf "$TOOLS/jdk.tar.gz" -C "$TOOLS/jdk-extract"
  inner="$(find "$TOOLS/jdk-extract" -maxdepth 1 -mindepth 1 -type d | head -1)"
  rm -rf "$TOOLS/jdk"; mv "$inner" "$TOOLS/jdk"
  rm -rf "$TOOLS/jdk-extract" "$TOOLS/jdk.tar.gz"
fi

if [[ ! -f "$JADX_JAR" ]]; then
  echo "[deps] 下载 jadx-headless-mcp 0.7.1 ..."
  curl -fL --retry 3 -o "$JADX_JAR" "$JADX_URL"
fi
echo "$JADX_SHA  $JADX_JAR" | sha256sum -c - >/dev/null

"$TOOLS/jdk/bin/javac" -version
echo "[deps] ok"
echo "export JAVA_HOME=$TOOLS/jdk"
echo "export REA_JADX_MCP_JAR=$JADX_JAR"
