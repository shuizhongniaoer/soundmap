#!/bin/bash
# 安装 Qwen3-ASR（qwen-asr 包；模型约 3.4GB 首次转写时经 hf-mirror 自动下载）
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { echo "请先运行 ./start.sh 完成基础环境安装"; exit 1; }

echo "[qwen3] 安装 qwen-asr…"
./.venv/bin/pip install -U qwen-asr

echo "[qwen3] 完成。启动: HF_ENDPOINT=https://hf-mirror.com LOCAL_ASR_ENGINE=qwen3 ./start.sh"
echo "        （0.6B 小模型: 再加 QWEN3_ASR_MODEL=Qwen/Qwen3-ASR-0.6B）"
