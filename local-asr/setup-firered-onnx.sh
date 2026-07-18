#!/bin/bash
# 安装 FireRedASR-AED 的 int8 ONNX 量化版（sherpa-onnx 运行时，CPU 提速 3~6 倍）
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { echo "请先运行 ./start.sh 完成基础环境安装"; exit 1; }

echo "[firered-onnx] 安装 sherpa-onnx…"
./.venv/bin/pip install -U sherpa-onnx soundfile modelscope

M=sherpa-onnx-fire-red-asr-large-zh_en-2025-02-16
if [ ! -d "pretrained_models/$M" ]; then
  echo "[firered-onnx] 下载 int8 模型（约 1.2GB，先试 ModelScope）…"
  ./.venv/bin/modelscope download --model "csukuangfj/$M" --local_dir "pretrained_models/$M" || {
    echo "[firered-onnx] ModelScope 无此仓库，改从 GitHub Release 下载…"
    curl -L -o "/tmp/$M.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$M.tar.bz2"
    mkdir -p pretrained_models && tar xjf "/tmp/$M.tar.bz2" -C pretrained_models/
  }
fi

echo "[firered-onnx] 完成。启动: LOCAL_ASR_ENGINE=firered-onnx ./start.sh"
echo "              （可加 ONNX_PROVIDER=coreml 尝试用 Mac 神经引擎再提速）"
