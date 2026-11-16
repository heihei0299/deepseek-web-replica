#!/usr/bin/env bash
# REA 安卓分析封装：统一环境变量、把完整 JSON 落到 evidence/
set -euo pipefail
WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="${APK:-$WS/artifacts/deepseek.apk}"
export JAVA_HOME="${JAVA_HOME:-$WS/.tools/jdk}"
export REA_JADX_MCP_JAR="${REA_JADX_MCP_JAR:-$WS/.tools/android/jadx-headless-mcp-0.7.1-all.jar}"
export REA_APKTOOL_COMMAND="${REA_APKTOOL_COMMAND:-$WS/.tools/apktool}"
EVID="$WS/evidence"
mkdir -p "$EVID"
ts="$(date +%Y%m%d-%H%M%S)"

run() { # run <标签> <rea 子命令与参数...>
  local label="$1"; shift
  local out="$EVID/$ts-$label.json"
  echo "[rea] $* -> $out"
  rea "$@" --format json > "$out" 2>"$out.err" || { echo "[rea] 失败，见 $out.err"; tail -5 "$out.err"; return 1; }
  echo "[rea] ok ($(wc -c < "$out") bytes)"
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  package)    run package    inspect-android-package "$APK" ;;
  signature)  run signature  inspect-apk-signature "$APK" ;;
  resources)  run resources  decode-android-resources "$APK" ;;
  classes)    run "classes-${1:-all}" search-android-classes "$APK" "${1:-}" ;;
  class)      run "class-${1//\//_}" inspect-android-class "$APK" "$1" ;;
  method)     run "method-${2}" inspect-android-method "$APK" "$1" "$2" ${3:+--overload-index "$3"} ;;
  refs)       run "refs-${1##*.}" trace-android-references "$APK" "$1" ${2:+--method-name "$2"} ${3:+--overload-index "$3"} ;;
  doctor)     JAVA_HOME="$JAVA_HOME" REA_JADX_MCP_JAR="$REA_JADX_MCP_JAR" rea doctor --provider jadx --json ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}"; echo "用法: $0 {package|signature|resources|classes [query]|class <FQN>|method <FQN> <m> [idx]|refs <FQN> [m]|doctor}" ;;
esac
