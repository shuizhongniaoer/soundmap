# 本地转写引擎抽象：funasr（默认）/ firered / qwen3
# 统一输出: {language, segments: [{start, end, speaker, text}]}
import os
import subprocess
import tempfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def to_wav16k(path):
    """任意音频 -> 16kHz 单声道 16bit wav（FireRed/Qwen3 的标准输入）"""
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000",
         "-acodec", "pcm_s16le", out],
        check=True,
    )
    return out


def slice_wav(wav, beg_ms, end_ms):
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", wav,
         "-ss", str(beg_ms / 1000), "-to", str(end_ms / 1000), "-c", "copy", out],
        check=True,
    )
    return out


class Chunker:
    """FSMN-VAD 切句，合并为 <=max_sec 的块（FireRed AED 上限 60s，留余量）"""

    def __init__(self):
        from funasr import AutoModel
        self.vad = AutoModel(model="fsmn-vad", disable_update=True)

    def chunks(self, wav, max_sec=45, max_gap_ms=1200):
        res = self.vad.generate(input=wav)
        raw = res[0]["value"] if res else []  # [[beg_ms, end_ms], ...]
        merged = []
        for beg, end in raw:
            if merged and end - merged[-1][0] <= max_sec * 1000 and beg - merged[-1][1] <= max_gap_ms:
                merged[-1][1] = end
            else:
                merged.append([beg, end])
        return merged


# ---------------- FunASR 全家桶（现状默认，含说话人分离） ----------------
class FunasrEngine:
    name = "funasr"

    def __init__(self):
        from funasr import AutoModel
        self.model = AutoModel(
            model=os.environ.get("LOCAL_ASR_MODEL", "paraformer-zh"),
            vad_model="fsmn-vad", punc_model="ct-punc", spk_model="cam++",
            disable_update=True,
        )

    def transcribe(self, path, hotwords):
        kwargs = {"batch_size_s": 300}
        if hotwords:
            kwargs["hotword"] = " ".join(hotwords)
        res = self.model.generate(input=path, **kwargs)
        out = res[0] if res else {}
        segments = []
        for s in out.get("sentence_info") or []:
            text = (s.get("text") or "").strip()
            if text:
                segments.append({
                    "start": round(s.get("start", 0) / 1000),
                    "end": round(s.get("end", 0) / 1000),
                    "speaker": f"说话人{int(s.get('spk', 0)) + 1}",
                    "text": text,
                })
        if not segments and (out.get("text") or "").strip():
            segments = [{"start": 0, "end": 0, "speaker": "说话人1", "text": out["text"].strip()}]
        return {"language": "zh", "segments": segments}


# ---------------- FireRedASR-AED（中文开源 SOTA 档；试验引擎，暂无分人） ----------------
class FireredEngine:
    name = "firered"

    def __init__(self):
        repo = os.path.join(BASE_DIR, "FireRedASR")
        model_dir = os.path.join(BASE_DIR, "pretrained_models", "FireRedASR-AED-L")
        if not (os.path.isdir(repo) and os.path.isdir(model_dir)):
            raise RuntimeError("FireRedASR 未安装：先运行 ./local-asr/setup-firered.sh（下载代码与约4GB模型）")
        import sys
        sys.path.insert(0, repo)
        # PyTorch 2.6+ 默认 weights_only=True，拒载 FireRed 官方旧格式权重（含 argparse.Namespace）。
        # 模型来自官方 ModelScope 仓库（可信来源），放开限制。
        import argparse
        import torch
        try:
            torch.serialization.add_safe_globals([argparse.Namespace])
        except Exception:
            pass
        _orig_load = torch.load
        def _load(*a, **k):
            k.setdefault("weights_only", False)
            return _orig_load(*a, **k)
        torch.load = _load
        from fireredasr.models.fireredasr import FireRedAsr
        self.model = FireRedAsr.from_pretrained("aed", model_dir)
        self.chunker = Chunker()
        from funasr import AutoModel
        self.punc = AutoModel(model="ct-punc", disable_update=True)  # AED 裸文本无标点

    def transcribe(self, path, hotwords):  # hotwords: AED 不支持，忽略
        wav = to_wav16k(path)
        segments = []
        for beg, end in self.chunker.chunks(wav):
            piece = slice_wav(wav, beg, end)
            res = self.model.transcribe(["u"], [piece], {
                "use_gpu": 0, "beam_size": 3, "nbest": 1, "decode_max_len": 0,
                "softmax_smoothing": 1.25, "aed_length_penalty": 0.6, "eos_penalty": 1.0,
            })
            text = (res[0].get("text") or "").strip() if res else ""
            os.unlink(piece)
            if not text:
                continue
            try:
                text = self.punc.generate(input=text)[0]["text"]
            except Exception:
                pass
            segments.append({"start": beg // 1000, "end": end // 1000,
                             "speaker": "说话人1", "text": text})
        os.unlink(wav)
        return {"language": "zh", "segments": segments}


# ---------------- Qwen3-ASR-1.7B（方言最全，自带标点；试验引擎，暂无分人） ----------------
class Qwen3Engine:
    name = "qwen3"

    def __init__(self):
        try:
            import torch
            from qwen_asr import Qwen3ASRModel
        except ImportError as e:
            raise RuntimeError("qwen-asr 未安装：先运行 ./local-asr/setup-qwen3.sh") from e
        device = os.environ.get("QWEN3_DEVICE", "cpu")  # Mac 可试 mps
        # 优先用 setup-qwen3.sh 从 ModelScope 下到本地的模型目录（不依赖外网）
        local_dir = os.path.join(BASE_DIR, "pretrained_models", "Qwen3-ASR-1.7B")
        model_id = os.environ.get("QWEN3_ASR_MODEL") or (
            local_dir if os.path.isdir(local_dir) else "Qwen/Qwen3-ASR-1.7B")
        self.model = Qwen3ASRModel.from_pretrained(
            model_id,
            dtype=torch.float32 if device == "cpu" else torch.float16,
            device_map=device,
        )
        self.chunker = Chunker()

    def _run(self, piece, hotwords):
        try:
            if hotwords:
                try:  # Qwen3-ASR 支持上下文偏置（人名等），接口若不收此参则退化
                    return self.model.transcribe(piece, context=" ".join(hotwords))
                except TypeError:
                    pass
            return self.model.transcribe(piece)
        except AttributeError as e:
            raise RuntimeError(f"qwen_asr 接口与预期不符: {e}；可把此错误发给开发者调整适配") from e

    @staticmethod
    def _text(out):
        if isinstance(out, list):
            out = out[0] if out else ""
        if hasattr(out, "text"):  # qwen_asr 返回 ASRTranscription 对象
            return (out.text or "").strip()
        if isinstance(out, dict):
            return (out.get("text") or out.get("transcript") or "").strip()
        return str(out or "").strip()

    def transcribe(self, path, hotwords):
        wav = to_wav16k(path)
        segments = []
        for beg, end in self.chunker.chunks(wav):
            piece = slice_wav(wav, beg, end)
            text = self._text(self._run(piece, hotwords))
            os.unlink(piece)
            if text:
                segments.append({"start": beg // 1000, "end": end // 1000,
                                 "speaker": "说话人1", "text": text})
        os.unlink(wav)
        return {"language": "zh", "segments": segments}


# ---------------- FireRedASR ONNX int8（sherpa-onnx 运行时，CPU 提速 3~6 倍） ----------------
class FireredOnnxEngine:
    name = "firered-onnx"

    def __init__(self):
        try:
            import sherpa_onnx  # noqa: F401
        except ImportError as e:
            raise RuntimeError("sherpa-onnx 未安装：先运行 ./local-asr/setup-firered-onnx.sh") from e
        import sherpa_onnx
        d = os.path.join(BASE_DIR, "pretrained_models",
                         "sherpa-onnx-fire-red-asr-large-zh_en-2025-02-16")
        if not os.path.isdir(d):
            raise RuntimeError("FireRed ONNX 模型缺失：先运行 ./local-asr/setup-firered-onnx.sh")
        self.rec = sherpa_onnx.OfflineRecognizer.from_fire_red_asr(
            encoder=os.path.join(d, "encoder.int8.onnx"),
            decoder=os.path.join(d, "decoder.int8.onnx"),
            tokens=os.path.join(d, "tokens.txt"),
            num_threads=max(2, (os.cpu_count() or 4) - 2),
            provider=os.environ.get("ONNX_PROVIDER", "cpu"),  # 可试 coreml 吃 Mac 神经引擎
            decoding_method="greedy_search",
        )
        self.chunker = Chunker()
        from funasr import AutoModel
        self.punc = AutoModel(model="ct-punc", disable_update=True)

    def transcribe(self, path, hotwords):  # hotwords 不支持
        import soundfile as sf
        wav = to_wav16k(path)
        data, sr = sf.read(wav, dtype="float32")
        bounds = self.chunker.chunks(wav)
        streams = []
        for beg, end in bounds:
            s = self.rec.create_stream()
            s.accept_waveform(sr, data[int(beg / 1000 * sr):int(end / 1000 * sr)])
            streams.append(s)
        if streams:
            self.rec.decode_streams(streams)  # 批量解码，吃满多核
        segments = []
        for (beg, end), s in zip(bounds, streams):
            text = (s.result.text or "").strip()
            if not text:
                continue
            try:
                text = self.punc.generate(input=text)[0]["text"]
            except Exception:
                pass
            segments.append({"start": beg // 1000, "end": end // 1000,
                             "speaker": "说话人1", "text": text})
        os.unlink(wav)
        return {"language": "zh", "segments": segments}


# ---------------- FireRedASR2S（二代全家桶：自带 VAD/LID/标点，句级时间戳） ----------------
class Firered2Engine:
    name = "firered2"

    def __init__(self):
        repo = os.path.join(BASE_DIR, "FireRedASR2S")
        pm = os.path.join(repo, "pretrained_models")
        need = ["FireRedASR2-AED", "FireRedVAD", "FireRedLID", "FireRedPunc"]
        if not os.path.isdir(repo) or not all(os.path.isdir(os.path.join(pm, n)) for n in need):
            raise RuntimeError("FireRedASR2S 未安装：先运行 ./local-asr/setup-firered2.sh（代码+约5GB模型）")
        import sys
        sys.path.insert(0, repo)
        # torch.load 兼容补丁（同 v1，官方权重可信来源）
        import argparse
        import torch
        try:
            torch.serialization.add_safe_globals([argparse.Namespace])
        except Exception:
            pass
        _orig = torch.load
        def _load(*a, **k):
            k.setdefault("weights_only", False)
            return _orig(*a, **k)
        torch.load = _load

        from fireredasr2s.fireredasr2 import FireRedAsr2Config
        from fireredasr2s.fireredlid import FireRedLidConfig
        from fireredasr2s.fireredpunc import FireRedPuncConfig
        from fireredasr2s.fireredvad import FireRedVadConfig
        from fireredasr2s import FireRedAsr2System, FireRedAsr2SystemConfig

        use_gpu = os.environ.get("FIRERED2_GPU", "0") == "1"  # NVIDIA 上设 1，12 倍速
        cfg = FireRedAsr2SystemConfig(
            os.path.join(pm, "FireRedVAD", "VAD"),
            os.path.join(pm, "FireRedLID"),
            "aed", os.path.join(pm, "FireRedASR2-AED"),
            os.path.join(pm, "FireRedPunc"),
            FireRedVadConfig(use_gpu=False),
            FireRedLidConfig(use_gpu=use_gpu, use_half=False),
            FireRedAsr2Config(use_gpu=use_gpu, use_half=False, beam_size=3, nbest=1,
                              decode_max_len=0, softmax_smoothing=1.25,
                              aed_length_penalty=0.6, eos_penalty=1.0,
                              return_timestamp=False),
            FireRedPuncConfig(use_gpu=use_gpu),
            enable_vad=1, enable_lid=1, enable_punc=1,
        )
        self.system = FireRedAsr2System(cfg)

    def transcribe(self, path, hotwords):  # hotwords 不支持
        wav = to_wav16k(path)
        result = self.system.process(wav) or {}
        segments = []
        for s in result.get("sentences") or []:
            text = (s.get("text") or "").strip()
            if text:
                segments.append({"start": round(s.get("start_ms", 0) / 1000),
                                 "end": round(s.get("end_ms", 0) / 1000),
                                 "speaker": "说话人1", "text": text})
        if not segments and (result.get("text") or "").strip():
            segments = [{"start": 0, "end": 0, "speaker": "说话人1", "text": result["text"].strip()}]
        os.unlink(wav)
        return {"language": "zh", "segments": segments}


ENGINES = {
    "funasr": FunasrEngine,
    "firered": FireredEngine,
    "firered-onnx": FireredOnnxEngine,
    "firered2": Firered2Engine,
    "qwen3": Qwen3Engine,
}


def build_engine(name):
    name = (name or "funasr").lower()
    if name not in ENGINES:
        raise RuntimeError(f"未知引擎 {name}，可选: {list(ENGINES)}")
    return ENGINES[name]()
