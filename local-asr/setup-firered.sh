#!/bin/bash
# 安装 FireRedASR-AED（代码 + 约 4GB 模型，走 ModelScope 国内直连）
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { echo "请先运行 ./start.sh 完成基础环境安装"; exit 1; }

if [ ! -d FireRedASR ]; then
  echo "[firered] 下载推理代码…"
  git clone --depth 1 https://github.com/FireRedTeam/FireRedASR.git
fi
echo "[firered] 安装依赖…"
./.venv/bin/pip install kaldiio sentencepiece modelscope 2>/dev/null || true

echo "[firered] 从 ModelScope 下载模型 FireRedASR-AED-L（约 4GB，国内直连）…"
./.venv/bin/modelscope download --model pengzhendong/FireRedASR-AED-L \
  --local_dir pretrained_models/FireRedASR-AED-L

echo "[firered] 完成。启动: LOCAL_ASR_ENGINE=firered ./start.sh"
