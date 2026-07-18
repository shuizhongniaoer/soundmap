#!/bin/bash
# 安装 Qwen3-ASR（qwen-asr 包 + 模型走 ModelScope 国内直连，约 3.4GB）
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { echo "请先运行 ./start.sh 完成基础环境安装"; exit 1; }

echo "[qwen3] 安装 qwen-asr…"
./.venv/bin/pip install -U qwen-asr modelscope

echo "[qwen3] 从 ModelScope 下载模型 Qwen3-ASR-1.7B（约 3.4GB，国内直连）…"
./.venv/bin/modelscope download --model Qwen/Qwen3-ASR-1.7B \
  --local_dir pretrained_models/Qwen3-ASR-1.7B

echo "[qwen3] 完成。启动: LOCAL_ASR_ENGINE=qwen3 ./start.sh"
echo "        （引擎会自动使用本地已下载的模型目录，无需再连外网）"
