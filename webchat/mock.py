"""
Mock 模式：当 OPENCLAW_WEBCHAT_MOCK=1 时，所有 API 返回模拟数据，不调用真实服务。

用法：
    OPENCLAW_WEBCHAT_MOCK=1 python webchat/server_fast.py

各接口返回格式与真实接口完全一致，前端无需任何改动。
"""

import json
import os
import pathlib
import shutil

# Mock 状态：追踪声纹注册情况
_speaker_enrolled = {}  # speaker_id -> True

# mock 音频资源目录
_MOCK_RESOURCE_DIR = pathlib.Path(os.path.dirname(__file__)) / "mock_resource"


def ensure_mock_tts_file(tts_dir):
    """将 mock 音频文件复制到 TTS_DIR，确保 /api/tts-files/ 可以访问。"""
    src = _MOCK_RESOURCE_DIR / "mock_tts.mp3"
    if src.exists():
        tts_dir.mkdir(parents=True, exist_ok=True)
        dst = tts_dir / "mock_tts.mp3"
        if not dst.exists():
            shutil.copy2(str(src), str(dst))


def handle_mock_post(path, raw=b"", headers=None):
    """根据请求路径返回 mock 响应。不匹配的路径返回 None，由 server_fast 正常处理。"""
    payload = {}
    if raw:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            pass

    handler = _ROUTES.get(path)
    if handler:
        return handler(payload, headers=headers)
    return None


def handle_mock_get(path, query_params=None, headers=None):
    """GET 请求的 mock 响应。不匹配的路径返回 None。"""
    handler = _GET_ROUTES.get(path)
    if handler:
        return handler(query_params or {}, headers=headers)
    return None


# ---------------------------------------------------------------------------
# Mock 响应数据
# ---------------------------------------------------------------------------

def _mock_chat(payload, headers=None):
    """POST /api/chat — 模拟 LLM 对话回复"""
    session = payload.get("session", "mock-session")
    message = payload.get("message", "")
    knowledge_enabled = payload.get("knowledgeEnabled", True)

    reply = (
        "## 飞行的关键要素\n\n"
        "根据航空知识库，飞行安全需要关注以下几个方面：\n\n"
        "### 1. 重量与平衡\n"
        "确保航空器的**重量和重心**处于安全范围内，这是飞行安全的基础。\n\n"
        "### 2. 不同飞行阶段的重点\n"
        "每个飞行阶段都有特定的操作重点：\n\n"
        "| 阶段 | 重点 |\n"
        "|------|------|\n"
        "| 起飞 | 跑道状态、气象条件 |\n"
        "| 巡航 | 航路飞行、高度层保持 |\n"
        "| 着陆 | 进近程序、天气标准 |\n\n"
        "### 3. 关键检查项\n\n"
        "- [x] 重量和平衡计算\n"
        "- [x] 气象条件确认\n"
        "- [x] 航空器性能核实\n"
        "- [ ] 空管指令确认\n\n"
        "### 4. 代码示例\n\n"
        "```python\n"
        "def check_flight_safety(aircraft):\n"
        "    weight = aircraft.get_weight()\n"
        "    balance = aircraft.get_balance()\n"
        "    return weight <= MAX_WEIGHT and MIN_BALANCE <= balance <= MAX_BALANCE\n"
        "```\n\n"
        "> **提示：** 飞行前务必完成所有检查项，确保飞行安全。\n\n"
        "---\n\n"
        "*来源：航空飞行知识库中文示例*"
    )
    messages = [
        {"role": "user", "content": message, "ts": 1000},
        {"role": "assistant", "content": reply, "ts": 2000},
    ]
    # 模拟知识库引用数据
    citations = []
    if knowledge_enabled:
        citations = [
            {
                "text": "[Mock] 这是一条模拟知识库检索结果，用于测试引用语料卡片的渲染效果。",
                "source": "mock-doc-example.pdf",
                "score": 0.92,
                "page": 1,
            },
            {
                "text": "[Mock] 第二条模拟检索结果，展示多条引用时的排版效果。",
                "source": "mock-doc-example.pdf",
                "score": 0.85,
                "page": 3,
            },
        ]
    return {
        "ok": True,
        "session": session,
        "reply": reply,
        "messages": messages,
        "runId": None,
        "mode": "mock",
        "elapsedMs": 0,
        "meta": {
            "mode": "mock",
            "model": "mock-model",
            "knowledge": {
                "enabled": knowledge_enabled,
                "disabled_by_request": not knowledge_enabled,
                "citations": citations,
            },
        },
    }


def _mock_chat_suggestions(payload, headers=None):
    """POST /api/chat/suggestions — 模拟推荐追问"""
    return {
        "ok": True,
        "session": payload.get("session", ""),
        "suggestions": [
            "目视飞行规则的最低天气标准是什么？",
            "按照仪表飞行规则飞行的航空器需要哪些设备？",
            "航空器在什么情况下可以改为按目视飞行规则飞行？",
        ],
        "meta": {"mode": "mock"},
    }


def _mock_transcribe(payload, headers=None):
    """POST /api/transcribe — 模拟 ASR 转写"""
    # TODO: 可以根据上传文件大小返回不同长度的 mock 文本
    return {
        "ok": True,
        "text": "[Mock] 这是一段模拟转写文本。",
        "meta": {"language": "zh", "engine": "mock"},
        "upload": {
            "id": "mock-upload",
            "filename": "mock-audio.wav",
            "bytes": 0,
            "sha256": "mock-sha256",
            "url": None,
        },
    }


def _mock_tts(payload, headers=None):
    """POST /api/tts — 模拟 TTS 语音合成，返回 mock_resource/mock_tts.mp3"""
    src = _MOCK_RESOURCE_DIR / "mock_tts.mp3"
    audio_bytes = src.stat().st_size if src.exists() else 0
    return {
        "ok": True,
        "audio": {
            "url": "/api/tts-files/mock_tts.mp3",
            "filename": "mock_tts.mp3",
            "bytes": audio_bytes,
            "mode": "mock",
            "voice": payload.get("voice", "zh-CN-XiaoxiaoNeural"),
            "provider": "mock",
        },
        "meta": {"provider": "mock"},
    }


def _mock_wake_check(payload, headers=None):
    """POST /api/wake-check — 模拟唤醒词检测 + 声纹验证"""
    h = headers or {}
    wake_phrase = h.get("X-Wake-Phrase", "") or "你好"
    speaker_id = h.get("X-Speaker-Id", "owner")
    speaker_match_mode = h.get("X-Speaker-Match-Mode", "all")
    return {
        "ok": True,
        "matched": True,
        "wake_matched": True,
        "speaker_matched": True,
        "speaker_score": 0.95,
        "speaker_threshold": 0.31,
        "speaker_enabled": True,
        "speaker_id": speaker_id,
        "speaker_match_mode": speaker_match_mode,
        "speaker_backend": "mock",
        "speaker_model_id": None,
        "speaker_reason": "mock mode",
        "speaker_error": None,
        "speaker": {},
        "text": f"mock {wake_phrase}",
        "meta": {"engine": "mock"},
    }


def _mock_knowledge_search(payload, headers=None):
    """POST /api/knowledge/search — 模拟知识库检索"""
    query = payload.get("query", "")
    return {
        "ok": True,
        "query": query,
        "knowledge": {"enabled": True, "num_chunks": 4, "num_docs": 2},
        "results": [
            {
                "text": "航空飞行基础知识文档指出，航空飞行过程通常可以划分为飞行前准备、推出和滑行、起飞、爬升、巡航、下降、进近、着陆和滑入停机位等阶段。",
                "source": "航空飞行知识库中文示例.txt",
                "score": 0.92,
                "page": 1,
            },
            {
                "text": "起飞和着陆阶段对跑道状态、气象条件、航空器性能和空管指令要求较高；巡航阶段更关注航路飞行、高度层保持、燃油管理和空域协调。",
                "source": "pilot_handbook.pdf",
                "score": 0.85,
                "page": 3,
            },
        ],
    }


def _mock_speaker_enroll(payload, headers=None):
    """POST /api/speaker/enroll — 模拟声纹注册"""
    h = headers or {}
    speaker_id = h.get("X-Speaker-Id", "owner")
    _speaker_enrolled[speaker_id] = True
    return {
        "ok": True,
        "speaker_id": speaker_id,
        "num_samples": 3,
        "profile_dir": f"/mock/speakers/{speaker_id}",
        "message": "speaker enrolled",
    }


def _mock_speaker_verify(payload, headers=None):
    """POST /api/speaker/verify — 模拟声纹验证"""
    h = headers or {}
    speaker_id = h.get("X-Speaker-Id", "owner")
    enrolled = _speaker_enrolled.get(speaker_id, False)
    return {
        "ok": True,
        "enabled": True,
        "matched": enrolled,
        "score": 0.92 if enrolled else None,
        "threshold": 0.31,
        "speaker_id": speaker_id,
        "num_samples": 3 if enrolled else 0,
        "model_id": "mock-model",
        "backend": "mock",
    }


# GET 路由表：path -> handler(query_params, headers) -> dict
_GET_ROUTES = {
    "/api/speaker/status": lambda params, headers: _mock_speaker_status(params, headers),
}


def _mock_speaker_status(params, headers=None):
    """GET /api/speaker/status — 模拟声纹状态"""
    speaker_id = (params.get("speaker_id") or ["owner"])[0]
    enrolled = _speaker_enrolled.get(speaker_id, False)
    return {
        "ok": True,
        "enabled": True,
        "speaker_id": speaker_id,
        "threshold": 0.31,
        "has_profile": enrolled,
        "num_samples": 3 if enrolled else 0,
        "profile_dir": f"/mock/speakers/{speaker_id}",
        "profiles": [{"speaker_id": speaker_id, "num_samples": 3 if enrolled else 0, "has_profile": enrolled}] if enrolled else [],
        "sample_strategy": "best",
        "model_id": "mock-model",
        "configured_model_id": "mock-model",
        "backend": "mock",
        "model_loaded": True,
        "model_error": None,
    }


# 路由表：path -> handler(payload) -> dict
_ROUTES = {
    "/api/chat": _mock_chat,
    "/api/chat/suggestions": _mock_chat_suggestions,
    "/api/transcribe": _mock_transcribe,
    "/api/tts": _mock_tts,
    "/api/wake-check": _mock_wake_check,
    "/api/knowledge/search": _mock_knowledge_search,
    "/api/speaker/enroll": _mock_speaker_enroll,
    "/api/speaker/verify": _mock_speaker_verify,
}
