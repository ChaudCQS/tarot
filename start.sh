#!/bin/sh
# 起一个本地静态服务，浏览器里打开 http://127.0.0.1:8848/
# 必须走 http，不能双击 index.html —— file:// 打开时浏览器会拦掉调 DeepSeek 的跨域请求
set -e
cd "$(dirname "$0")"
PORT="${1:-8848}"
URL="http://127.0.0.1:$PORT/"
echo "塔罗占卜页：$URL"
echo "按 Ctrl+C 停止"
( sleep 1; command -v open >/dev/null 2>&1 && open "$URL" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
