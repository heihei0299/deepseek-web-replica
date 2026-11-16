#!/usr/bin/env bash
# web-fetch.sh — 重新抓取 chat.deepseek.com 的前端制品（逆向输入，不入库）
set -euo pipefail
cd "$(dirname "$0")/.."

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
OUT=reverse/web
mkdir -p "$OUT"

curl -fsSL -A "$UA" -o "$OUT/index.html" https://chat.deepseek.com/
# 从 index.html 里解析带哈希的入口文件，避免写死版本号
MAIN_JS=$(grep -oE 'https://fe-static\.deepseek\.com/chat/static/main\.[a-f0-9]+\.js' "$OUT/index.html" | head -1)
MAIN_CSS=$(grep -oE 'https://fe-static\.deepseek\.com/chat/static/main\.[a-f0-9]+\.css' "$OUT/index.html" | head -1)
VENDOR_JS=$(grep -oE 'https://fe-static\.deepseek\.com/chat/static/default-vendors\.[a-f0-9]+\.js' "$OUT/index.html" | head -1)

curl -fsSL -A "$UA" -o "$OUT/main.$(basename "$MAIN_JS" | cut -d. -f2).js" "$MAIN_JS"
curl -fsSL -A "$UA" -o "$OUT/main.$(basename "$MAIN_CSS" | cut -d. -f2).css" "$MAIN_CSS"
curl -fsSL -A "$UA" -o "$OUT/$(basename "$VENDOR_JS")" "$VENDOR_JS"

# PoW Worker 的 chunk 名随版本变化，从 main.js 的 chunk 映射里取；已知 37627 为 pow worker
CHUNK=$(grep -oE '37627:"[a-f0-9]+"' "$OUT"/main.*.js | head -1 | cut -d'"' -f2)
[ -n "$CHUNK" ] && curl -fsSL -A "$UA" -o "$OUT/pow-worker.js" "https://fe-static.deepseek.com/chat/static/37627.$CHUNK.js"

echo "抓取完成："
ls -l "$OUT"
echo
echo "提示：裸 curl 可能被 WAF 判 429，本脚本固定使用桌面 UA。"
