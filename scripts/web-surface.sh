#!/usr/bin/env bash
# web-surface.sh — 复现 web 客户端网络面与流式协议观察
# 用法: bash scripts/web-surface.sh > evidence/$(date +%Y%m%d-%H%M%S)-web-surface.txt
set -euo pipefail
cd "$(dirname "$0")/.."

WEB=reverse/web
JS="$WEB/main.ada2c4f5c4.js"
CSS="$WEB/main.css"
ctx() { node scripts/web-ctx.mjs "$JS" "$1" "$2" "${@:3}"; }

echo "# web bundle 观察 $(date -Iseconds)"
echo
echo "## 1. 制品"
ls -l "$WEB"
sha256sum "$JS" "$CSS" "$WEB/pow-worker.js" "$WEB/index.html" 2>/dev/null || true
echo
echo "## 2. 接口清单（字面量）"
grep -oE '"/api/v[0-9]/[a-z0-9_/-]+"' "$JS" | sort -u
echo
echo "## 3. 客户端自有请求头"
grep -oE '"x-(client|ds|device|model|request|settings|thinking|file|hif|debug)[a-z-]*"' "$JS" | sort -u
echo
echo "## 4. PoW 响应头构造（base64(JSON)）"
ctx 160 260 'challenge-response' || true
echo
echo "## 5. 挑战获取"
ctx 120 460 'create_pow_challenge' | head -20 || true
echo
echo "## 6. PoW 求解 worker"
node scripts/web-ctx.mjs "$WEB/pow-worker.js" 220 320 'wasm_solve' | head -20 || true
echo
echo "## 7. SSE 事件名枚举"
ctx 60 520 'NewSSEEventName||' | head -20 || true
echo
echo "## 8. delta 操作(p/o/v, SET|BATCH|APPEND)"
ctx 120 620 '"BATCH"' | head -24 || true
echo
echo "## 9. 补全请求体字段"
ctx 220 460 'thinking_enabled:e.request.thinkingEnabled' | head -12 || true
echo
echo "## 10. 是否存在客户端拼装 system 消息"
printf 'role:"system" 命中: '; grep -c -F 'role:"system"' "$JS" || true
printf '"system"      命中: '; grep -o -F '"system"' "$JS" | wc -l
printf 'You are a helpful 命中: '; grep -c -F 'You are a helpful' "$JS" || true
echo
echo "## 11. 设计令牌（品牌/中性蓝）"
grep -oE '\-\-dsw-static-(deepseek|neutral-bluish)-[0-9]+:[^;}]+' "$CSS" | sort -u | head -30
