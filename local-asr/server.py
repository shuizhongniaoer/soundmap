# 声图 · 本地转写服务
# 三引擎可切换（环境变量 LOCAL_ASR_ENGINE）：
#   funasr  - FunASR 全家桶（默认）：Paraformer + VAD + 标点 + CAM++ 说话人分离 + 热词
#   firered - FireRedASR-AED：中文开源 SOTA 档（试验引擎，暂无分人/热词）
#   qwen3   - Qwen3-ASR-1.7B：52 语种方言，自带标点（试验引擎，暂无分人）
# 首次使用某引擎会自动/按脚本下载模型，之后离线运行。
import os
import time
import traceback

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="soundmap-local-asr")
ENGINE_NAME = os.environ.get("LOCAL_ASR_ENGINE", "funasr")
_engine = None


def get_engine():
    global _engine
    if _engine is None:
        print(f"[local-asr] 加载引擎 {ENGINE_NAME}（首次可能需下载模型）…")
        t0 = time.time()
        from engines import build_engine
        _engine = build_engine(ENGINE_NAME)
        print(f"[local-asr] 引擎 {ENGINE_NAME} 就绪，耗时 {time.time() - t0:.0f}s")
    return _engine


class Req(BaseModel):
    path: str                 # 音频文件绝对路径（与 Node 服务同机）
    hotwords: list[str] = []


@app.get("/")
def index():
    return {"service": "soundmap-local-asr", "engine": ENGINE_NAME,
            "status": "running", "model_loaded": _engine is not None,
            "hint": "本服务由声图主程序调用。切换引擎: LOCAL_ASR_ENGINE=firered|qwen3|funasr ./start.sh"}


@app.get("/health")
def health():
    return {"ok": True, "engine": ENGINE_NAME, "loaded": _engine is not None}


@app.post("/transcribe")
def transcribe(req: Req):
    try:
        eng = get_engine()
        t0 = time.time()
        result = eng.transcribe(req.path, req.hotwords)
        print(f"[local-asr/{ENGINE_NAME}] {req.path}: {len(result['segments'])} 句, 耗时 {time.time() - t0:.1f}s")
        return result
    except Exception as e:  # 把真实错误透传给主服务，方便定位
        traceback.print_exc()
        return JSONResponse(status_code=500,
                            content={"error": f"[{ENGINE_NAME}] {type(e).__name__}: {e}"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8100)
