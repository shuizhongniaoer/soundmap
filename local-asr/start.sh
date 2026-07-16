#!/bin/bash
# 声图本地转写服务：首次运行自动建 venv + 装依赖 + 下载模型
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[local-asr] 创建 Python 虚拟环境…"
  python3 -m venv .venv
  ./.venv/bin/pip install -U pip
  echo "[local-asr] 安装依赖（torch 较大，几分钟）…"
  ./.venv/bin/pip install -r requirements.txt
fi

echo "[local-asr] 启动服务 http://127.0.0.1:8100 （首次会下载模型约1~2GB）"
exec ./.venv/bin/python server.py
