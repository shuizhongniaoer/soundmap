#!/bin/bash
# 安装 FireRedASR2S 二代全家桶（代码 + 约 5GB 模型：AED2/VAD/LID/Punc，走 ModelScope）
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { echo "请先运行 ./start.sh 完成基础环境安装"; exit 1; }

if [ ! -d FireRedASR2S ]; then
  echo "[firered2] 下载推理代码…"
  git clone --depth 1 https://github.com/FireRedTeam/FireRedASR2S.git
fi

echo "[firered2] 安装依赖（与现有 venv 共用，如报版本冲突把错误发给 AI 处理）…"
./.venv/bin/pip install -r FireRedASR2S/requirements.txt || \
  echo "[firered2] 警告：部分依赖安装失败，可先尝试启动，报错再处理"

echo "[firered2] 从 ModelScope 下载 4 个模型（共约 5GB）…"
for m in FireRedASR2-AED FireRedVAD FireRedLID FireRedPunc; do
  ./.venv/bin/modelscope download --model "xukaituo/$m" \
    --local_dir "FireRedASR2S/pretrained_models/$m"
done

echo "[firered2] 完成。启动: LOCAL_ASR_ENGINE=firered2 ./start.sh"
echo "          （NVIDIA GPU 机器上加 FIRERED2_GPU=1，速度提升一个量级）"
