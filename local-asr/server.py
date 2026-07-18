# 声图 · 本地转写服务（FunASR）
# 全家桶：FSMN-VAD 切句 + Paraformer-large 识别 + CT-Punc 标点 + CAM++ 说话人分离 + SeACo 热词
# 首次启动会自动从 ModelScope 下载模型（约 1~2GB），之后离线运行。
import os
import time

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="soundmap-local-asr")
_model = None


def get_model():
    global _model
    if _model is None:
        print("[local-asr] 首次加载模型（首次运行需下载约 1~2GB，请耐心等待）…")
        t0 = time.time()
        from funasr import AutoModel
        _model = AutoModel(
            # 可用环境变量 LOCAL_ASR_MODEL 换模型（如电话 8k 专用模型），默认 Paraformer-large 16k
            model=os.environ.get("LOCAL_ASR_MODEL", "paraformer-zh"),
            vad_model="fsmn-vad",        # 语音活动检测（切句）
            punc_model="ct-punc",        # 标点恢复
            spk_model="cam++",           # 说话人分离
            disable_update=True,
        )
        print(f"[local-asr] 模型就绪，耗时 {time.time() - t0:.0f}s")
    return _model


class Req(BaseModel):
    path: str                 # 音频文件绝对路径（与 Node 服务同机）
    hotwords: list[str] = []  # 热词（SeACo-Paraformer 上下文偏置）


@app.get("/")
def index():
    return {"service": "soundmap-local-asr", "status": "running",
            "model_loaded": _model is not None,
            "hint": "本服务由声图主程序调用，无需在浏览器操作。健康检查: /health"}


@app.get("/health")
def health():
    return {"ok": True, "loaded": _model is not None}


@app.post("/transcribe")
def transcribe(req: Req):
    m = get_model()
    kwargs = {"batch_size_s": 300}
    if req.hotwords:
        kwargs["hotword"] = " ".join(req.hotwords)
    t0 = time.time()
    res = m.generate(input=req.path, **kwargs)
    out = res[0] if res else {}
    segments = []
    for s in out.get("sentence_info") or []:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        segments.append({
            "start": round(s.get("start", 0) / 1000),
            "end": round(s.get("end", 0) / 1000),
            "speaker": f"说话人{int(s.get('spk', 0)) + 1}",
            "text": text,
        })
    # 极短音频可能没有 sentence_info，退化为整段
    if not segments and (out.get("text") or "").strip():
        segments = [{"start": 0, "end": 0, "speaker": "说话人1", "text": out["text"].strip()}]
    print(f"[local-asr] {req.path} 转写完成: {len(segments)} 句, 耗时 {time.time() - t0:.1f}s")
    return {"language": "zh", "segments": segments}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8100)
