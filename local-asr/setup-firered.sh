#!/bin/bash
# 安装 FireRedASR-AED（代码 + 约 4GB 模型，经 hf-mirror 国内可下）
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { echo "请先运行 ./start.sh 完成基础环境安装"; exit 1; }

if [ ! -d FireRedASR ]; then
  echo "[firered] 下载推理代码…"
  git clone --depth 1 https://github.com/FireRedTeam/FireRedASR.git
fi
echo "[firered] 安装依赖（与 funasr 共用 venv，如报版本冲突把错误发给 AI 处理）…"
./.venv/bin/pip install kaldiio sentencepiece 2>/dev/null || true
./.venv/bin/pip install -U "huggingface_hub[cli]"

export HF_ENDPOINT=${HF_ENDPOINT:-https://hf-mirror.com}
echo "[firered] 下载模型 FireRedASR-AED-L（约 4GB，走 $HF_ENDPOINT）…"
./.venv/bin/huggingface-cli download fireredteam/FireRedASR-AED-L \
  --local-dir pretrained_models/FireRedASR-AED-L

echo "[firered] 完成。启动: LOCAL_ASR_ENGINE=firered ./start.sh"
