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


def handle_mock_post(path, raw=b""):
    """根据请求路径返回 mock 响应。不匹配的路径返回 None，由 server_fast 正常处理。"""
    payload = {}
    if raw:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            pass

    handler = _ROUTES.get(path)
    if handler:
        return handler(payload)
    return None


# ---------------------------------------------------------------------------
# Mock 响应数据
# ---------------------------------------------------------------------------

def _mock_chat(payload):
    """POST /api/chat — 模拟 LLM 对话回复"""
    session = payload.get("session", "mock-session")
    message = payload.get("message", "")
    knowledge_enabled = payload.get("knowledgeEnabled", True)
    # TODO: 根据 message 内容返回不同的 mock 回复
    reply = (
        "这是 Mock 模式的模拟回复。\n\n"
        "您发送的消息是：" + (message[:100] if message else "(空)")
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


def _mock_chat_suggestions(payload):
    """POST /api/chat/suggestions — 模拟推荐追问"""
    # TODO: 根据 question/answer 上下文返回不同的追问
    return {
        "ok": True,
        "session": payload.get("session", ""),
        "suggestions": [
            "Mock 追问一：能否详细说明？",
            "Mock 追问二：有哪些相关案例？",
            "Mock 追问三：适用范围是什么？",
        ],
        "meta": {"mode": "mock"},
    }


def _mock_transcribe(payload):
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


def _mock_tts(payload):
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


def _mock_wake_check(payload):
    """POST /api/wake-check — 模拟唤醒词检测"""
    # TODO: 可以根据 wake_phrase 参数返回不同的匹配结果
    return {
        "ok": True,
        "matched": True,
        "wake_matched": True,
        "speaker_matched": True,
        "speaker_score": 0.95,
        "speaker_threshold": 0.31,
        "speaker_enabled": False,
        "speaker_id": "mock-user",
        "speaker_match_mode": "all",
        "speaker_backend": "mock",
        "speaker_model_id": None,
        "speaker_reason": "mock mode",
        "speaker_error": None,
        "speaker": {},
        "text": "mock 唤醒词",
        "meta": {"engine": "mock"},
    }


def _mock_knowledge_search(payload):
    """POST /api/knowledge/search — 模拟知识库检索"""
    query = payload.get("query", "")
    # TODO: 根据 query 返回不同的 mock 检索结果
    return {
        "ok": True,
        "query": query,
        "knowledge": {"enabled": True, "num_chunks": 0, "num_docs": 0},
        "results": [
            {
                "text": "[Mock] 这是一条模拟检索结果。",
                "source": "mock-doc.pdf",
                "score": 0.9,
                "page": 1,
            },
        ],
    }


# 路由表：path -> handler(payload) -> dict
_ROUTES = {
    "/api/chat": _mock_chat,
    "/api/chat/suggestions": _mock_chat_suggestions,
    "/api/transcribe": _mock_transcribe,
    "/api/tts": _mock_tts,
    "/api/wake-check": _mock_wake_check,
    "/api/knowledge/search": _mock_knowledge_search,
}
