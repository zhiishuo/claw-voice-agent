#!/usr/bin/env python3
import base64
import json
import os
import pathlib
import re
import hashlib
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OPENCLAW_HOME = pathlib.Path(
    os.environ.get("OPENCLAW_HOME", str(pathlib.Path.home() / ".openclaw"))
)
OPENCLAW_PYTHON = os.environ.get("OPENCLAW_PYTHON", sys.executable)
COSYVOICE_PYDEPS = os.environ.get("COSYVOICE_PYDEPS", str(OPENCLAW_HOME / "cosyvoice-pydeps"))
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from services.speaker.speaker_verify import SpeakerVerifier
except ModuleNotFoundError:
    SERVICES_DIR = pathlib.Path(__file__).resolve().parents[1]
    if str(SERVICES_DIR) not in sys.path:
        sys.path.insert(0, str(SERVICES_DIR))
    from speaker.speaker_verify import SpeakerVerifier

FRONTEND_DIR = pathlib.Path(os.environ.get("OPENCLAW_WEBCHAT_FRONTEND_DIR", str(PROJECT_ROOT / "webchat/frontend")))

HOST = "0.0.0.0"
PORT = int(os.environ.get("OPENCLAW_WEBCHAT_PORT", "18889"))
OPENCLAW_BIN = os.environ.get("OPENCLAW_BIN", str(OPENCLAW_HOME / "bin/openclaw"))
ASR_URL = os.environ.get("OPENCLAW_WEBCHAT_ASR_URL", "http://127.0.0.1:9460/transcribe")
COSYVOICE_TTS_URL = os.environ.get("OPENCLAW_WEBCHAT_COSYVOICE_URL", "http://127.0.0.1:9461/synthesize")
SHERPA_WAKE_URL = os.environ.get("OPENCLAW_WEBCHAT_SHERPA_WAKE_URL", "http://127.0.0.1:9462/check")
AGENT_ID = os.environ.get("OPENCLAW_WEBCHAT_AGENT", "localqwen")
FAST_MODE = os.environ.get("OPENCLAW_WEBCHAT_FAST_MODE", "1").strip().lower() not in {"0", "false", "no"}
FAST_LLM_URL = os.environ.get("OPENCLAW_FAST_LLM_URL", "http://127.0.0.1:8000/v1/chat/completions")
FAST_LLM_MODEL = os.environ.get("OPENCLAW_FAST_LLM_MODEL", "qwen-local")
FAST_LLM_API_KEY = os.environ.get("OPENCLAW_FAST_LLM_API_KEY", "vllm-local")
FAST_LLM_MAX_TOKENS = int(os.environ.get("OPENCLAW_FAST_LLM_MAX_TOKENS", "96"))
FAST_LLM_TIMEOUT = float(os.environ.get("OPENCLAW_FAST_LLM_TIMEOUT", "4.0"))
FAST_HISTORY_TURNS = int(os.environ.get("OPENCLAW_FAST_HISTORY_TURNS", "3"))
FAST_TTS_MAX_CHARS = int(os.environ.get("OPENCLAW_FAST_TTS_MAX_CHARS", "0"))
DATA_DIR = pathlib.Path(os.environ.get("OPENCLAW_WEBCHAT_DATA", str(OPENCLAW_HOME / "webchat/data")))
UPLOAD_DIR = pathlib.Path(os.environ.get("OPENCLAW_WEBCHAT_UPLOADS", str(OPENCLAW_HOME / "webchat/uploads")))
TTS_DIR = pathlib.Path(os.environ.get("OPENCLAW_WEBCHAT_TTS", str(OPENCLAW_HOME / "webchat/tts")))
WEBCHAT_TOKEN = os.environ.get("OPENCLAW_WEBCHAT_TOKEN", "").strip()
MAX_AUDIO_BYTES = 25 * 1024 * 1024
TARGET_SAMPLE_RATE = 16000
LOG_PATH = pathlib.Path(os.environ.get("OPENCLAW_WEBCHAT_LOG", str(OPENCLAW_HOME / "webchat/debug.log")))
OPENCLAW_CONFIG_PATH = pathlib.Path(os.environ.get("OPENCLAW_CONFIG_PATH", str(OPENCLAW_HOME / "openclaw.json")))
TLS_CERT_PATH = os.environ.get("OPENCLAW_WEBCHAT_TLS_CERT", "").strip()
TLS_KEY_PATH = os.environ.get("OPENCLAW_WEBCHAT_TLS_KEY", "").strip()
LOCK = threading.Lock()
SPEAKER_VERIFIER = SpeakerVerifier()

try:
    from knowledge_service import KNOWLEDGE_SERVICE
except Exception as exc:
    class _UnavailableKnowledgeService:
        def __init__(self, error):
            self._error = str(error)

        def status(self):
            return {"enabled": False, "loaded": False, "error": self._error}

        def retrieve(self, query, top_k=None, mode=None):
            return []

        def build_prompt_context(self, query):
            return "", []

    KNOWLEDGE_SERVICE = _UnavailableKnowledgeService(exc)

# 把事件写到日志文件，也打印到 stdout。前端的“最近动作”和唤醒调试，很多都依赖这个日志。
def log_event(event, **fields):
    payload = {"ts": int(time.time() * 1000), "event": event, **fields}
    line = json.dumps(payload, ensure_ascii=False)
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass
    print(line, flush=True)


def make_server_id(prefix):
    return f"{prefix}-{int(time.time() * 1000)}-{os.urandom(3).hex()}"


def resolve_expected_token():
    if WEBCHAT_TOKEN:
        return WEBCHAT_TOKEN
    try:
        cfg = json.loads(OPENCLAW_CONFIG_PATH.read_text(encoding="utf-8"))
        return str((((cfg.get("gateway") or {}).get("auth") or {}).get("token")) or "").strip()
    except Exception:
        return ""


def extract_auth_token(handler, parsed_url):
    header_token = handler.headers.get("X-Webchat-Token", "").strip()
    if header_token:
        return header_token
    query = urllib.parse.parse_qs(parsed_url.query)
    return str((query.get("token") or [""])[0]).strip()


def require_auth(handler, parsed_url):
    expected = resolve_expected_token()
    if not expected:
        return True
    provided = extract_auth_token(handler, parsed_url)
    return provided == expected


def load_frontend_text(name: str, fallback: str = "") -> str:
    path = FRONTEND_DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    return fallback


def static_response(handler, path: pathlib.Path, content_type: str):
    if not path.exists() or not path.is_file():
        json_response(handler, HTTPStatus.NOT_FOUND, {"error": "not_found"})
        return
    body = path.read_bytes()
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)

INDEX_HTML = r'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Claw 语音工作台</title>
  <style>
    :root { --bg:#0f1115; --panel:#171a21; --panel-2:#1d212b; --border:#2a3140; --text:#e9edf5; --muted:#9aa4b5; --accent:#ff5c5c; --accent-2:#3dd9b3; }
    * { box-sizing:border-box; }
    body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:linear-gradient(180deg,#0b0d12 0%,var(--bg) 100%); color:var(--text); }
    .app { max-width:1040px; margin:0 auto; padding:28px 16px 40px; }
    .topbar { display:flex; gap:16px; align-items:flex-end; justify-content:space-between; margin-bottom:18px; flex-wrap:wrap; }
    .brand { display:flex; flex-direction:column; gap:8px; }
    .brand__eyebrow { display:inline-flex; align-items:center; width:max-content; padding:6px 10px; border-radius:999px; border:1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); background:color-mix(in srgb, var(--accent) 10%, #10131a); color:var(--text); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
    .title { font-size:28px; line-height:1.1; font-weight:700; letter-spacing:-.03em; }
    .subtitle { color:var(--muted); font-size:13px; }
    .session-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .auth-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .auth-status { font-size:12px; color:var(--muted); }
    .workspace { display:grid; grid-template-columns:320px minmax(0, 1fr); gap:18px; align-items:start; }
    .workspace-main { min-width:0; display:flex; flex-direction:column; gap:14px; }
    .panel { background:color-mix(in srgb,var(--panel) 88%,transparent); border:1px solid var(--border); border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.25); }
    .robot-panel { position:sticky; top:18px; overflow:hidden; }
    .robot-panel__body { padding:16px; display:flex; flex-direction:column; gap:14px; }
    .robot-card { border:1px solid color-mix(in srgb, var(--border-strong) 82%, transparent); border-radius:18px; padding:16px; background:radial-gradient(circle at top, rgba(61,217,179,.12), transparent 42%), linear-gradient(180deg, #171b24 0%, #12161d 100%); display:flex; flex-direction:column; gap:14px; }
    .robot-card--listening { box-shadow:0 0 0 1px rgba(61,217,179,.32), 0 0 28px rgba(61,217,179,.16); }
    .robot-card--uploading,
    .robot-card--transcribing { box-shadow:0 0 0 1px rgba(255,209,102,.28), 0 0 28px rgba(255,209,102,.12); }
    .robot-card--thinking,
    .robot-card--speaking { box-shadow:0 0 0 1px rgba(255,92,92,.28), 0 0 28px rgba(255,92,92,.12); }
    .robot-card--error { box-shadow:0 0 0 1px rgba(255,123,114,.36), 0 0 28px rgba(255,123,114,.14); }
    .robot-avatar { display:grid; place-items:center; min-height:164px; }
    .robot-shell-figure { position:relative; width:150px; height:150px; }
    .robot-shell-figure__halo { position:absolute; inset:10px; border-radius:50%; background:radial-gradient(circle, rgba(61,217,179,.16), transparent 68%); filter:blur(6px); }
    .robot-shell-figure__body { position:absolute; inset:18px; border-radius:36px; border:1px solid rgba(255,255,255,.09); background:linear-gradient(180deg, #f5f7fb 0%, #d4dbe8 100%); box-shadow:inset 0 -10px 20px rgba(15,17,21,.12), 0 22px 40px rgba(0,0,0,.18); }
    .robot-shell-figure__body::before,
    .robot-shell-figure__body::after { content:""; position:absolute; top:-10px; width:22px; height:22px; border-radius:999px; background:#f5f7fb; border:1px solid rgba(17,20,27,.08); }
    .robot-shell-figure__body::before { left:26px; }
    .robot-shell-figure__body::after { right:26px; }
    .robot-shell-figure__visor { position:absolute; left:26px; right:26px; top:34px; height:44px; border-radius:24px; background:linear-gradient(180deg, #0f1724 0%, #151f2d 100%); border:1px solid rgba(255,255,255,.06); display:flex; align-items:center; justify-content:center; gap:18px; overflow:hidden; }
    .robot-shell-figure__eye { width:18px; height:18px; border-radius:999px; background:linear-gradient(180deg, #6ef3cf 0%, #1ecfa3 100%); box-shadow:0 0 16px rgba(61,217,179,.45); transition:transform .18s ease, opacity .18s ease; }
    .robot-shell-figure__eye--blink { transform:scaleY(.18); opacity:.85; }
    .robot-shell-figure__mouth { position:absolute; left:48px; right:48px; bottom:34px; height:12px; border-radius:999px; background:rgba(17,20,27,.14); overflow:hidden; }
    .robot-shell-figure__mouth-fill { height:100%; width:26%; border-radius:999px; background:linear-gradient(90deg, #ff9f7a 0%, #ff5c5c 100%); margin-inline:auto; transition:width .18s ease; }
    .robot-card__mode { display:flex; flex-direction:column; gap:4px; }
    .robot-card__mode-label { font-size:15px; font-weight:800; letter-spacing:-.02em; }
    .robot-card__mode-detail { font-size:12px; color:var(--muted); white-space:pre-wrap; }
    .robot-flow { display:flex; flex-direction:column; gap:8px; }
    .robot-flow__item { display:grid; grid-template-columns:18px minmax(0, 1fr); gap:10px; padding:8px 10px; border-radius:12px; background:#10131a; border:1px solid rgba(255,255,255,.04); }
    .robot-flow__dot { width:10px; height:10px; border-radius:50%; margin-top:4px; background:#455066; box-shadow:0 0 0 4px rgba(69,80,102,.12); }
    .robot-flow__item.active .robot-flow__dot { background:var(--accent); box-shadow:0 0 0 4px rgba(255,92,92,.16); }
    .robot-flow__item.done .robot-flow__dot { background:var(--accent-2); box-shadow:0 0 0 4px rgba(61,217,179,.16); }
    .robot-flow__item.error .robot-flow__dot { background:#ff7b72; box-shadow:0 0 0 4px rgba(255,123,114,.18); }
    .robot-flow__label { font-size:12px; font-weight:700; color:var(--text); }
    .robot-flow__detail { font-size:11px; color:var(--muted); white-space:pre-wrap; word-break:break-word; margin-top:2px; }
    .robot-bubble-stack { display:flex; flex-direction:column; gap:8px; }
    .robot-bubble { border-radius:14px; padding:10px 12px; border:1px solid rgba(255,255,255,.06); background:#10131a; }
    .robot-bubble--user { background:linear-gradient(180deg, rgba(255,92,92,.18), rgba(255,92,92,.08)); }
    .robot-bubble__title { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:4px; }
    .robot-bubble__text { font-size:12px; color:var(--text); white-space:pre-wrap; word-break:break-word; }
    .messages { height:min(72vh,820px); overflow:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
    .msg { max-width:82%; padding:12px 14px; border-radius:16px; white-space:pre-wrap; word-break:break-word; }
    .msg.user { align-self:flex-end; background:linear-gradient(180deg,#ff6666 0%,#e54e4e 100%); color:white; }
    .msg.assistant { align-self:flex-start; background:var(--panel-2); border:1px solid var(--border); }
    .msg.system { align-self:center; max-width:100%; background:#12151b; border:1px dashed var(--border); color:var(--muted); font-size:12px; }
    .composer { margin-top:14px; padding:14px; display:flex; flex-direction:column; gap:10px; }
    textarea, input[type="text"], select { width:100%; background:#10131a; color:var(--text); border:1px solid var(--border); border-radius:12px; padding:12px 14px; }
    textarea { min-height:96px; resize:vertical; }
    button { background:var(--panel-2); color:var(--text); border:1px solid var(--border); border-radius:12px; padding:10px 14px; cursor:pointer; }
    button.primary { background:var(--accent); color:white; border-color:transparent; }
    button.accent2 { background:var(--accent-2); color:#08120f; border-color:transparent; font-weight:700; }
    button:disabled { opacity:.55; cursor:not-allowed; }
    .controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:space-between; }
    .controls-left,.controls-right { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .status { color:var(--muted); font-size:12px; min-height:18px; }
    .badge { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; border:1px solid var(--border); background:#11151d; font-size:12px; }
    .meter { display:flex; align-items:center; gap:8px; min-width:220px; }
    .meter__bar { flex:1; height:10px; border-radius:999px; background:#0b0d12; border:1px solid var(--border); overflow:hidden; }
    .meter__fill { height:100%; width:0%; background:linear-gradient(90deg, #3dd9b3 0%, #ffd166 55%, #ff5c5c 100%); transition:width 80ms linear; }
    .meter__text { width:50px; text-align:right; font-size:11px; color:var(--muted); }
    .process { margin-top:14px; padding:14px; display:flex; flex-direction:column; gap:12px; }
    .process-title { font-size:13px; font-weight:700; color:var(--text); }
    .process-subtitle { font-size:12px; color:var(--muted); }
    .pipeline-steps { display:none; }
    .process-log { border:1px solid var(--border); border-radius:12px; background:#10131a; max-height:240px; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:8px; }
    .process-log__item { border-bottom:1px solid rgba(255,255,255,.04); padding-bottom:8px; }
    .process-log__item:last-child { border-bottom:none; padding-bottom:0; }
    .process-log__time { font-size:11px; color:var(--muted); margin-bottom:2px; }
    .process-log__label { font-size:12px; color:var(--text); font-weight:700; margin-bottom:2px; }
    .process-log__detail { font-size:12px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
    .capture-proof { border:1px solid var(--border); border-radius:12px; background:#10131a; padding:10px; display:flex; flex-direction:column; gap:8px; }
    .capture-proof__meta { font-size:12px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
    .capture-proof audio { width:100%; }
    .upload-proof { border:1px solid var(--border); border-radius:12px; background:#10131a; padding:10px; display:flex; flex-direction:column; gap:8px; }
    .upload-proof__meta { font-size:12px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
    .upload-proof audio { width:100%; }
    .tts-proof { border:1px solid var(--border); border-radius:12px; background:#10131a; padding:10px; display:flex; flex-direction:column; gap:8px; }
    .tts-proof__meta { font-size:12px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
    .tts-proof audio { width:100%; }
    .wake-proof { border:1px solid var(--border); border-radius:12px; background:#10131a; padding:10px; display:flex; flex-direction:column; gap:8px; }
    .wake-proof__meta { font-size:12px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
    .hidden { display:none !important; }
    @media (max-width:980px) { .workspace { grid-template-columns:1fr; } .robot-panel { position:static; } }
    @media (max-width:720px) { .msg { max-width:100%; } .messages { height:58vh; } .controls { align-items:stretch; } .title { font-size:24px; } .robot-shell-figure { width:132px; height:132px; } }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="brand">
        <div class="brand__eyebrow">Claw Voice Desk</div>
        <div class="title">Claw 语音工作台</div>
        <div class="subtitle">先确认麦克风输入正常，再把浏览器原始录音上传到服务器转写；转写文本确认后，再决定是否送进 OpenClaw。</div>
      </div>
      <div class="session-row">
        <span class="badge">Session</span>
        <input id="sessionInput" type="text" style="width:240px" />
        <button id="newSessionBtn">新会话</button>
      </div>
      <div class="auth-row">
        <span class="badge">访问令牌</span>
        <input id="tokenInput" type="password" style="width:280px" placeholder="输入 token 后连接" />
        <button id="authBtn">连接</button>
        <span id="authStatus" class="auth-status">未认证</span>
      </div>
    </div>
    <div class="workspace">
      <aside class="panel robot-panel">
        <div class="robot-panel__body">
          <div class="robot-card" id="robotCard">
            <div class="robot-avatar">
              <div class="robot-shell-figure">
                <div class="robot-shell-figure__halo"></div>
                <div class="robot-shell-figure__body">
                  <div class="robot-shell-figure__visor">
                    <div class="robot-shell-figure__eye" id="robotEyeLeft"></div>
                    <div class="robot-shell-figure__eye" id="robotEyeRight"></div>
                  </div>
                  <div class="robot-shell-figure__mouth">
                    <div class="robot-shell-figure__mouth-fill" id="robotMouthFill"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="robot-card__mode">
              <div class="robot-card__mode-label" id="robotModeLabel">待命</div>
              <div class="robot-card__mode-detail" id="robotModeDetail">选择麦克风后开始录音。</div>
            </div>
          </div>
          <div class="robot-flow" id="pipelineSteps"></div>
          <div class="robot-bubble-stack">
            <div id="robotUserBubble" class="robot-bubble robot-bubble--user hidden">
              <div class="robot-bubble__title">你刚刚说了</div>
              <div id="robotUserBubbleText" class="robot-bubble__text"></div>
            </div>
            <div id="robotAssistantBubble" class="robot-bubble hidden">
              <div class="robot-bubble__title">机器人准备说</div>
              <div id="robotAssistantBubbleText" class="robot-bubble__text"></div>
            </div>
          </div>
          <div id="captureProof" class="capture-proof hidden">
            <div class="process-title">本地录音</div>
            <div id="captureProofMeta" class="capture-proof__meta"></div>
            <audio id="captureProofAudio" controls preload="metadata"></audio>
          </div>
          <div id="uploadProof" class="upload-proof hidden">
            <div class="process-title">服务器副本</div>
            <div id="uploadProofMeta" class="upload-proof__meta"></div>
            <audio id="uploadProofAudio" controls preload="metadata"></audio>
          </div>
          <div id="wakeProof" class="wake-proof hidden">
            <div class="process-title">唤醒词检测</div>
            <div id="wakeProofMeta" class="wake-proof__meta"></div>
          </div>
          <div id="ttsProof" class="tts-proof hidden">
            <div class="process-title">回复语音</div>
            <div id="ttsProofMeta" class="tts-proof__meta"></div>
            <audio id="ttsProofAudio" controls preload="metadata"></audio>
          </div>
        </div>
      </aside>
      <main class="workspace-main">
        <div class="panel"><div id="messages" class="messages"></div></div>
        <div class="panel composer">
      <textarea id="draft" placeholder="输入消息，或点录音/上传音频"></textarea>
      <div class="controls">
        <div class="controls-left">
          <button id="sendBtn" class="primary">发送</button>
          <button id="recordBtn" class="accent2">录音</button>
          <button id="uploadBtn">导入音频</button>
          <input id="audioInput" class="hidden" type="file" accept="audio/*" />
        </div>
        <div class="controls-right"><button id="reloadBtn">刷新</button></div>
      </div>
      <div class="controls">
        <div class="controls-left">
          <span class="badge">麦克风设备</span>
          <select id="micSelect" style="min-width:260px"></select>
          <button id="refreshMicsBtn">刷新</button>
        </div>
        <div class="controls-right">
          <div class="meter">
            <div class="meter__bar"><div id="inputLevelFill" class="meter__fill"></div></div>
            <div id="inputLevelText" class="meter__text">0%</div>
          </div>
        </div>
      </div>
      <div class="controls">
        <div class="controls-left">
          <span class="badge">唤醒词</span>
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted);">
            <input id="wakeToggle" type="checkbox" />
            自动唤醒
          </label>
          <input id="wakePhraseInput" type="text" style="width:180px" placeholder="你好" />
        </div>
        <div class="controls-right">
          <span id="wakeStatus" class="status">唤醒词待关闭</span>
        </div>
      </div>
      <div class="controls">
        <div class="controls-left">
          <span class="badge">转写语言</span>
          <select id="languageSelect">
            <option value="zh">中文</option>
            <option value="auto">自动</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="controls-right">
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted);">
            <input id="autoSendToggle" type="checkbox" />
            转写后自动发送给 OpenClaw
          </label>
        </div>
      </div>
      <div class="controls">
        <div class="controls-left">
          <span class="badge">模式</span>
          <select id="ttsModeSelect">
            <option value="api">Microsoft API</option>
            <option value="cosyvoice">CosyVoice 本地</option>
          </select>
          <span class="badge">回复语音</span>
          <select id="ttsVoiceSelect">
            <option value="zh-CN-XiaoxiaoNeural">晓晓</option>
            <option value="zh-CN-XiaoyiNeural">晓伊</option>
            <option value="zh-CN-YunyangNeural">云扬</option>
          </select>
        </div>
        <div class="controls-right">
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted);">
            <input id="autoTtsToggle" type="checkbox" />
            回复后自动合成并播放
          </label>
        </div>
      </div>
          <div id="status" class="status"></div>
        </div>
        <div class="panel process">
          <div>
            <div class="process-title">最近动作</div>
            <div class="process-subtitle">这里只保留最近发生的事情，便于快速确认机器人刚刚做了什么。</div>
          </div>
          <div id="processLog" class="process-log"></div>
        </div>
      </main>
    </div>
  </div>
  <script>
    const PIPELINE_ORDER = ["record", "upload", "transcribe", "transcript", "claw", "tts"];
    const PIPELINE_LABELS = {
      record: "1. 录音",
      upload: "2. 上传到服务器",
      transcribe: "3. 服务器转写",
      transcript: "4. 得到文本",
      claw: "5. 送进 OpenClaw",
      tts: "6. 回复语音",
    };
    const state = {
      session: null,
      busy: false,
      stream: null,
      mediaRecorder: null,
      mediaChunks: [],
      recording: false,
      monitorContext: null,
      monitorSource: null,
      analyser: null,
      meterTimer: null,
      micDevices: [],
      selectedDeviceId: "",
      inputLevel: 0,
      processEntries: [],
      stepState: {},
      stepStartedAt: {},
      transcriptLanguage: "zh",
      autoSend: false,
      pendingTranscript: "",
      lastUpload: null,
      localCapture: null,
      lastWakeProbe: null,
      lastTts: null,
      lastAssistantReply: "",
      clientId: "",
      currentRequestId: "",
      autoTts: true,
      ttsVoice: "zh-CN-XiaoxiaoNeural",
      ttsMode: "api",
      authToken: "",
      authenticated: false,
      wakeEnabled: true,
      wakePhrase: "你好",
      wakeSupported: false,
      wakeListening: false,
      wakeResumeTimer: null,
      wakeLastTriggerAt: 0,
      wakeRecorder: null,
      wakePending: false,
      wakeChunkBuffers: [],
      wakeChunkSamples: 0,
      wakeChunkSampleRate: 16000,
      wakeProcessor: null,
      wakeSilentGain: null,
      currentRecordAutoSend: false,
      currentRecordWakeTriggered: false,
      autoStopOnSilence: false,
      recordStartedAt: 0,
      speechSeenAt: 0,
      silenceSince: 0,
      stopRequested: false,
      wakeDebugTimer: null,
    };

    const $ = (id) => document.getElementById(id);
    const messagesEl = $("messages");
    const statusEl = $("status");
    const draftEl = $("draft");
    const sessionEl = $("sessionInput");
    const tokenInputEl = $("tokenInput");
    const authBtnEl = $("authBtn");
    const authStatusEl = $("authStatus");
    const sendBtn = $("sendBtn");
    const recordBtn = $("recordBtn");
    const uploadBtn = $("uploadBtn");
    const audioInput = $("audioInput");
    const micSelectEl = $("micSelect");
    const refreshMicsBtn = $("refreshMicsBtn");
    const inputLevelFillEl = $("inputLevelFill");
    const inputLevelTextEl = $("inputLevelText");
    const wakeToggleEl = $("wakeToggle");
    const wakePhraseInputEl = $("wakePhraseInput");
    const wakeStatusEl = $("wakeStatus");
    const reloadBtn = $("reloadBtn");
    const newSessionBtn = $("newSessionBtn");
    const pipelineStepsEl = $("pipelineSteps");
    const processLogEl = $("processLog");
    const languageSelectEl = $("languageSelect");
    const autoSendToggleEl = $("autoSendToggle");
    const ttsVoiceSelectEl = $("ttsVoiceSelect");
    const ttsModeSelectEl = $("ttsModeSelect");
    const autoTtsToggleEl = $("autoTtsToggle");
    const captureProofEl = $("captureProof");
    const captureProofMetaEl = $("captureProofMeta");
    const captureProofAudioEl = $("captureProofAudio");
    const uploadProofEl = $("uploadProof");
    const uploadProofMetaEl = $("uploadProofMeta");
    const uploadProofAudioEl = $("uploadProofAudio");
    const wakeProofEl = $("wakeProof");
    const wakeProofMetaEl = $("wakeProofMeta");
    const ttsProofEl = $("ttsProof");
    const ttsProofMetaEl = $("ttsProofMeta");
    const ttsProofAudioEl = $("ttsProofAudio");
    const robotCardEl = $("robotCard");
    const robotModeLabelEl = $("robotModeLabel");
    const robotModeDetailEl = $("robotModeDetail");
    const robotEyeLeftEl = $("robotEyeLeft");
    const robotEyeRightEl = $("robotEyeRight");
    const robotMouthFillEl = $("robotMouthFill");
    const robotUserBubbleEl = $("robotUserBubble");
    const robotUserBubbleTextEl = $("robotUserBubbleText");
    const robotAssistantBubbleEl = $("robotAssistantBubble");
    const robotAssistantBubbleTextEl = $("robotAssistantBubbleText");
    const sessionStore = window.sessionStorage;
    const WAKE_REARM_MS = 2500;
    const AUTO_STOP_MAX_MS = 15000;
    const AUTO_STOP_SILENCE_MS = 1200;
    const AUTO_STOP_LEVEL = 0.028;
    const WAKE_CHUNK_MS_EN = 1500;
    const WAKE_CHUNK_MS_ZH = 2400;

    function qsSession() {
      const url = new URL(window.location.href);
      return url.searchParams.get("session") || "";
    }

    function makeId(prefix) {
      const random = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/[^a-zA-Z0-9-]/g, "");
      return `${prefix}-${random}`;
    }

    function setSession(session) {
      state.session = session;
      sessionEl.value = session;
      const url = new URL(window.location.href);
      url.searchParams.set("session", session);
      history.replaceState({}, "", url.toString());
      sessionStore.setItem("openclaw-webchat-session", session);
    }

    function makeSession() {
      return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function deriveRobotMode() {
      if (Object.values(state.stepState).some((step) => step?.status === "error")) return { key: "error", label: "出错了", detail: "这一步出现了问题，查看最近动作或重新试一次。" };
      if (state.recording) return { key: "listening", label: "正在聆听", detail: "我在听你说话。先看输入电平条是否有波动。" };
      if (state.wakeEnabled && state.wakeListening) return { key: "idle", label: "待唤醒", detail: `正在等待唤醒词：${state.wakePhrase}` };
      if (state.stepState.upload?.status === "active") return { key: "uploading", label: "上传中", detail: "正在把浏览器原始录音送到服务器。" };
      if (state.stepState.transcribe?.status === "active") return { key: "transcribing", label: "转写中", detail: "服务器正在把音频变成文本。" };
      if (state.stepState.claw?.status === "active") return { key: "thinking", label: "思考中", detail: "OpenClaw 正在组织回复内容。" };
      if (state.stepState.tts?.status === "active") return { key: "speaking", label: "准备开口", detail: "正在把回复转换成语音。" };
      if (state.lastTts?.url) return { key: "speaking", label: "可以播放", detail: "回复语音已经生成，可以直接播放。" };
      if (state.pendingTranscript) return { key: "heard", label: "我听到了", detail: "转写已经完成，确认文本后就可以发送。" };
      return { key: "idle", label: "待命", detail: "选择麦克风后开始录音，或直接输入文字。" };
    }

    function setBusy(busy, text = "") {
      state.busy = busy;
      const blocked = busy || !state.authenticated;
      sendBtn.disabled = blocked;
      uploadBtn.disabled = blocked;
      reloadBtn.disabled = blocked;
      statusEl.textContent = text;
    }

    function withTokenUrl(raw) {
      if (!raw) return "";
      const url = new URL(raw, window.location.origin);
      if (state.authToken) url.searchParams.set("token", state.authToken);
      return url.toString();
    }

    function updateAuthUi() {
      authStatusEl.textContent = state.authenticated ? "已认证" : "未认证";
      authBtnEl.textContent = state.authenticated ? "已连接" : "连接";
      authBtnEl.disabled = state.authenticated;
      tokenInputEl.disabled = state.authenticated;
      const blocked = !state.authenticated || state.busy;
      sendBtn.disabled = blocked;
      uploadBtn.disabled = blocked;
      reloadBtn.disabled = blocked;
      newSessionBtn.disabled = !state.authenticated;
      recordBtn.disabled = !state.authenticated;
    }

    function renderInputLevel() {
      const pct = Math.max(0, Math.min(100, Math.round(state.inputLevel * 100)));
      inputLevelFillEl.style.width = `${pct}%`;
      inputLevelTextEl.textContent = `${pct}%`;
    }

    function normalizeWakeText(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[.,!?;:'"()\-_/\\，。！？；：、“”‘’\s]+/g, "");
    }

    function wakeLanguageCode() {
      return /^[\x00-\x7F]+$/.test(state.wakePhrase) ? "en" : "zh";
    }

    function wakeChunkMs() {
      return wakeLanguageCode() === "en" ? WAKE_CHUNK_MS_EN : WAKE_CHUNK_MS_ZH;
    }

    function base64Utf8(text) {
      const bytes = new TextEncoder().encode(String(text || ""));
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    }

    function floatTo16BitPCM(view, offset, input) {
      for (let i = 0; i < input.length; i += 1, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
    }

    function encodeWavBlobFromFloat32(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
      };
      writeString(0, "RIFF");
      view.setUint32(4, 36 + samples.length * 2, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, samples.length * 2, true);
      floatTo16BitPCM(view, 44, samples);
      return new Blob([buffer], { type: "audio/wav" });
    }

    function takeWakeChunk(sampleCount) {
      const out = new Float32Array(sampleCount);
      let offset = 0;
      while (offset < sampleCount && state.wakeChunkBuffers.length) {
        const chunk = state.wakeChunkBuffers[0];
        const n = Math.min(sampleCount - offset, chunk.length);
        out.set(chunk.subarray(0, n), offset);
        offset += n;
        if (n === chunk.length) {
          state.wakeChunkBuffers.shift();
        } else {
          state.wakeChunkBuffers[0] = chunk.subarray(n);
        }
      }
      state.wakeChunkSamples = Math.max(0, state.wakeChunkSamples - sampleCount);
      return out;
    }

    function updateWakeUi(extra = "") {
      wakeToggleEl.checked = !!state.wakeEnabled;
      wakePhraseInputEl.value = state.wakePhrase;
      wakeToggleEl.disabled = !state.authenticated || !state.wakeSupported;
      wakePhraseInputEl.disabled = !state.authenticated;
      if (!state.wakeSupported) {
        wakeStatusEl.textContent = "当前浏览器不支持唤醒词";
      } else if (!state.authenticated) {
        wakeStatusEl.textContent = "连接后可启用唤醒词";
      } else if (!state.wakeEnabled) {
        wakeStatusEl.textContent = "唤醒词已关闭";
      } else if (state.recording) {
        wakeStatusEl.textContent = "已唤醒，正在录音";
      } else if (state.wakeListening) {
        wakeStatusEl.textContent = `本地监听中：${state.wakePhrase}`;
      } else if (state.wakeEnabled) {
        wakeStatusEl.textContent = extra || "待机中，等待唤醒词";
      } else {
        wakeStatusEl.textContent = extra || "唤醒词准备中";
      }
    }

    function clearWakeResumeTimer() {
      if (state.wakeResumeTimer) clearTimeout(state.wakeResumeTimer);
      state.wakeResumeTimer = null;
    }

    function scheduleWakeResume(delay = 2200) {
      clearWakeResumeTimer();
      if (!state.wakeEnabled || !state.authenticated || !state.wakeSupported) return;
      state.wakeResumeTimer = setTimeout(() => {
        state.wakeResumeTimer = null;
        void startWakeListener();
      }, delay);
    }

    async function stopWakeListener() {
      clearWakeResumeTimer();
      const recorder = state.wakeRecorder;
      state.wakeRecorder = null;
      state.wakePending = false;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          try { recorder.stop(); } catch {}
        }
      }
      if (state.stream && !state.recording) {
        state.stream.getTracks().forEach((track) => track.stop());
        state.stream = null;
      }
      if (state.wakeProcessor) {
        try { state.wakeProcessor.disconnect(); } catch {}
      }
      if (state.wakeSilentGain) {
        try { state.wakeSilentGain.disconnect(); } catch {}
      }
      state.wakeProcessor = null;
      state.wakeSilentGain = null;
      state.wakeChunkBuffers = [];
      state.wakeChunkSamples = 0;
      if (!state.recording) {
        if (state.meterTimer) cancelAnimationFrame(state.meterTimer);
        state.meterTimer = null;
        if (state.monitorSource) {
          try { state.monitorSource.disconnect(); } catch {}
        }
        if (state.analyser) {
          try { state.analyser.disconnect(); } catch {}
        }
        if (state.monitorContext) {
          try { await state.monitorContext.close(); } catch {}
        }
        state.monitorContext = null;
        state.monitorSource = null;
        state.analyser = null;
        state.inputLevel = 0;
        renderInputLevel();
      }
      state.wakeListening = false;
      updateWakeUi();
      renderPipeline();
    }

    async function startWakeListener() {
      if (!state.wakeSupported || !state.wakeEnabled || !state.authenticated || state.recording || state.busy) {
        updateWakeUi();
        return;
      }
      if (state.wakeListening) return;
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: state.selectedDeviceId ? { exact: state.selectedDeviceId } : undefined,
            channelCount: 1,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        startLevelMonitor(state.stream);
        state.wakeChunkBuffers = [];
        state.wakeChunkSamples = 0;
        state.wakeChunkSampleRate = state.monitorContext?.sampleRate || 16000;
        const processor = state.monitorContext.createScriptProcessor(4096, 1, 1);
        const silentGain = state.monitorContext.createGain();
        silentGain.gain.value = 0;
        state.wakeProcessor = processor;
        state.wakeSilentGain = silentGain;
        state.wakeListening = true;
        updateWakeUi();
        logProcess("本地唤醒词监听已开启", `${state.wakePhrase}\nclientId=${state.clientId}`);
        renderPipeline();
        processor.onaudioprocess = (event) => {
          if (!state.wakeEnabled || state.recording || !state.wakeListening) return;
          const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
          state.wakeChunkBuffers.push(chunk);
          state.wakeChunkSamples += chunk.length;
          void flushWakeChunkIfReady();
        };
        state.monitorSource.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(state.monitorContext.destination);
      } catch (err) {
        state.wakeListening = false;
        updateWakeUi(`唤醒词启动失败：${err.message || err}`);
        logProcess("唤醒词启动失败", String(err.message || err));
      }
    }

    async function checkWakeWord(blob) {
      const reqId = makeId("wake");
      const headers = {
        "Content-Type": blob.type || "application/octet-stream",
        "X-Filename": `wake-${Date.now()}.webm`,
        "X-Wake-Language": wakeLanguageCode(),
        "X-Wake-Phrase-B64": base64Utf8(state.wakePhrase),
        "X-Client-Id": state.clientId,
        "X-Request-Id": reqId,
        "X-Session-Key": state.session,
      };
      const data = await api("/api/wake-check", {
        method: "POST",
        headers,
        body: blob,
      });
      if (data.matched) {
        logProcess("唤醒词分片命中", `${data.text || ""}\nrequestId=${reqId}`);
        return data.text || "";
      }
      return "";
    }

    async function flushWakeChunkIfReady() {
      const minSamples = Math.floor(state.wakeChunkSampleRate * (wakeChunkMs() / 1000));
      if (state.wakePending || state.wakeChunkSamples < minSamples) return;
      state.wakePending = true;
      try {
        const samples = takeWakeChunk(minSamples);
        const wavBlob = encodeWavBlobFromFloat32(samples, state.wakeChunkSampleRate);
        const chunkText = await checkWakeWord(wavBlob);
        if (!chunkText) return;
        const normalized = normalizeWakeText(chunkText);
        const target = normalizeWakeText(state.wakePhrase);
        if (!target || !normalized.includes(target)) return;
        const now = Date.now();
        if (now - state.wakeLastTriggerAt < WAKE_REARM_MS) return;
        state.wakeLastTriggerAt = now;
        logProcess("唤醒词命中", `${chunkText}\nrequestId=${makeId("wake")}`);
        state.wakeEnabled = false;
        stopWakeDebugPolling();
        await stopWakeListener();
        statusEl.textContent = `已检测到唤醒词：${chunkText}`;
        await startRecording({ autoStopOnSilence: true, autoSend: true, wakeDetectedText: chunkText });
      } finally {
        state.wakePending = false;
      }
    }

    function renderMicDevices() {
      const current = state.selectedDeviceId || "";
      micSelectEl.innerHTML = "";
      const devices = state.micDevices || [];
      if (!devices.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "默认麦克风";
        micSelectEl.appendChild(opt);
        micSelectEl.value = "";
        return;
      }
      for (const device of devices) {
        const opt = document.createElement("option");
        opt.value = device.deviceId || "";
        opt.textContent = device.label || `麦克风 ${micSelectEl.options.length + 1}`;
        micSelectEl.appendChild(opt);
      }
      const hasCurrent = devices.some((d) => (d.deviceId || "") === current);
      micSelectEl.value = hasCurrent ? current : (devices[0].deviceId || "");
      state.selectedDeviceId = micSelectEl.value;
    }

    async function refreshMicDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.micDevices = devices.filter((d) => d.kind === "audioinput");
        renderMicDevices();
        logProcess("刷新麦克风设备", `${state.micDevices.length} 个输入设备`);
      } catch (err) {
        logProcess("刷新麦克风设备失败", String(err.message || err));
      }
    }

    function startLevelMonitor(stream) {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      state.monitorContext = new AudioContextCtor();
      state.monitorSource = state.monitorContext.createMediaStreamSource(stream);
      state.analyser = state.monitorContext.createAnalyser();
      state.analyser.fftSize = 2048;
      state.monitorSource.connect(state.analyser);
      const data = new Uint8Array(state.analyser.frequencyBinCount);
      const tick = () => {
        if (!state.analyser) return;
        state.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        state.inputLevel = Math.sqrt(sum / data.length) * 4;
        renderInputLevel();
        if (state.recording && state.autoStopOnSilence && !state.stopRequested) {
          const now = Date.now();
          if (state.inputLevel >= AUTO_STOP_LEVEL) {
            state.speechSeenAt = now;
            state.silenceSince = 0;
          } else if (state.speechSeenAt && !state.silenceSince) {
            state.silenceSince = now;
          }
          if (state.recordStartedAt && now - state.recordStartedAt >= AUTO_STOP_MAX_MS) {
            state.stopRequested = true;
            statusEl.textContent = "达到最长录音时长，准备上传...";
            void stopRecordingAndUpload();
            return;
          }
          if (state.speechSeenAt && state.silenceSince && now - state.silenceSince >= AUTO_STOP_SILENCE_MS) {
            state.stopRequested = true;
            statusEl.textContent = "检测到停顿，准备上传...";
            void stopRecordingAndUpload();
            return;
          }
        }
        state.meterTimer = requestAnimationFrame(tick);
      };
      tick();
    }

    function fmtTime(ts) {
      return new Date(ts).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"});
    }

    function renderPipeline() {
      const robotMode = deriveRobotMode();
      robotCardEl.className = `robot-card robot-card--${robotMode.key}`;
      robotModeLabelEl.textContent = robotMode.label;
      robotModeDetailEl.textContent = robotMode.detail;
      const blink = robotMode.key === "idle" || robotMode.key === "thinking";
      robotEyeLeftEl.classList.toggle("robot-shell-figure__eye--blink", blink);
      robotEyeRightEl.classList.toggle("robot-shell-figure__eye--blink", blink);
      robotMouthFillEl.style.width = robotMode.key === "speaking" ? "72%" : robotMode.key === "listening" ? `${Math.max(18, Math.min(86, Math.round(state.inputLevel * 160)))}%` : robotMode.key === "thinking" ? "44%" : "26%";
      pipelineStepsEl.innerHTML = "";
      for (const key of PIPELINE_ORDER) {
        const meta = state.stepState[key] || {status: "idle", detail: "等待"};
        const div = document.createElement("div");
        div.className = `robot-flow__item ${meta.status}`;
        div.innerHTML = `<div class="robot-flow__dot"></div><div><div class="robot-flow__label">${PIPELINE_LABELS[key]}</div><div class="robot-flow__detail">${meta.detail || ""}</div></div>`;
        pipelineStepsEl.appendChild(div);
      }
      if (state.pendingTranscript) {
        robotUserBubbleEl.classList.remove("hidden");
        robotUserBubbleTextEl.textContent = state.pendingTranscript;
      } else {
        robotUserBubbleEl.classList.add("hidden");
        robotUserBubbleTextEl.textContent = "";
      }
      if (state.lastAssistantReply) {
        robotAssistantBubbleEl.classList.remove("hidden");
        robotAssistantBubbleTextEl.textContent = state.lastAssistantReply;
      } else {
        robotAssistantBubbleEl.classList.add("hidden");
        robotAssistantBubbleTextEl.textContent = "";
      }
      processLogEl.innerHTML = "";
      for (const entry of state.processEntries) {
        const div = document.createElement("div");
        div.className = "process-log__item";
        div.innerHTML = `<div class="process-log__time">${fmtTime(entry.ts)}</div><div class="process-log__label">${entry.label}</div><div class="process-log__detail">${entry.detail || ""}</div>`;
        processLogEl.appendChild(div);
      }
      if (state.localCapture && state.localCapture.url) {
        captureProofEl.classList.remove("hidden");
        captureProofMetaEl.textContent = `requestId=${state.localCapture.requestId}\nbytes=${state.localCapture.bytes}\nmimeType=${state.localCapture.mimeType}`;
        captureProofAudioEl.src = state.localCapture.url;
      } else {
        captureProofEl.classList.add("hidden");
        captureProofMetaEl.textContent = "";
        captureProofAudioEl.removeAttribute("src");
      }
      if (state.lastUpload && state.lastUpload.url) {
        uploadProofEl.classList.remove("hidden");
        uploadProofMetaEl.textContent = `clientId=${state.lastUpload.clientId || state.clientId}\nrequestId=${state.lastUpload.requestId || state.currentRequestId}\nsession=${state.lastUpload.session || state.session}\nuploadId=${state.lastUpload.id}\nfilename=${state.lastUpload.filename}\nbytes=${state.lastUpload.bytes}\nsha256=${state.lastUpload.sha256}`;
        uploadProofAudioEl.src = withTokenUrl(state.lastUpload.url);
      } else {
        uploadProofEl.classList.add("hidden");
        uploadProofMetaEl.textContent = "";
        uploadProofAudioEl.removeAttribute("src");
      }
      if (state.lastWakeProbe) {
        wakeProofEl.classList.remove("hidden");
        wakeProofMetaEl.textContent = `engine=${state.lastWakeProbe.engine || "unknown"}\nmatched=${state.lastWakeProbe.matched ? "yes" : "no"}\nphrase=${state.lastWakeProbe.wakePhrase || state.wakePhrase}\ntext=${state.lastWakeProbe.text || "[empty]"}\nrequestId=${state.lastWakeProbe.requestId || ""}\nbytes=${state.lastWakeProbe.bytes || ""}\nts=${state.lastWakeProbe.ts ? fmtTime(state.lastWakeProbe.ts) : ""}`;
      } else {
        wakeProofEl.classList.add("hidden");
        wakeProofMetaEl.textContent = "";
      }
      if (state.lastTts && state.lastTts.url) {
        ttsProofEl.classList.remove("hidden");
        ttsProofMetaEl.textContent = `requestId=${state.lastTts.requestId}\nvoice=${state.lastTts.voice}\nprovider=${state.lastTts.provider}\nbytes=${state.lastTts.bytes}\nfilename=${state.lastTts.filename}`;
        ttsProofAudioEl.src = withTokenUrl(state.lastTts.url);
      } else {
        ttsProofEl.classList.add("hidden");
        ttsProofMetaEl.textContent = "";
        ttsProofAudioEl.removeAttribute("src");
      }
    }

    function setStep(step, status, detail) {
      if (status === "active") state.stepStartedAt[step] = Date.now();
      state.stepState[step] = {status, detail};
      renderPipeline();
    }

    async function ensureVisibleStep(step, minMs) {
      const startedAt = state.stepStartedAt[step] || 0;
      if (!startedAt) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minMs) await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
    }

    function logProcess(label, detail = "") {
      state.processEntries.unshift({ts: Date.now(), label, detail});
      state.processEntries = state.processEntries.slice(0, 24);
      renderPipeline();
    }

    function resetProcess(reason = "等待新的输入") {
      state.stepState = {
        record: {status: "idle", detail: reason},
        upload: {status: "idle", detail: "未开始"},
        transcribe: {status: "idle", detail: "未开始"},
        transcript: {status: "idle", detail: "等待转写结果"},
        claw: {status: "idle", detail: "等待发送给 OpenClaw"},
      };
      state.pendingTranscript = "";
      state.lastTts = null;
      if (state.localCapture?.url) URL.revokeObjectURL(state.localCapture.url);
      state.localCapture = null;
      state.lastUpload = null;
      state.lastWakeProbe = null;
      state.lastAssistantReply = "";
      state.currentRequestId = "";
      renderPipeline();
    }

    async function enterStandby(reason = "等待唤醒词") {
      state.pendingTranscript = "";
      state.lastWakeProbe = null;
      state.lastAssistantReply = "";
      state.currentRequestId = "";
      draftEl.value = "";
      resetProcess(reason);
      statusEl.textContent = reason;
      if (state.wakeEnabled && state.authenticated) {
        startWakeDebugPolling();
        await startWakeListener();
      }
    }

    function addMessage(role, content) {
      const div = document.createElement("div");
      div.className = `msg ${role}`;
      div.textContent = content;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderMessages(items) {
      messagesEl.innerHTML = "";
      if (!items.length) {
        addMessage("system", "新会话已就绪。可以直接发文本，或录音/上传音频。\n\n录音不会在浏览器里识别，而是上传到服务器后转写。")
        return;
      }
      for (const item of items) addMessage(item.role || "system", item.content || "");
    }

    async function api(path, init = {}) {
      const headers = new Headers(init.headers || {});
      if (state.authToken) headers.set("X-Webchat-Token", state.authToken);
      const req = { ...init, headers };
      const res = await fetch(path, req);
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if (!res.ok) {
        const message = data && data.error ? data.error : text || `HTTP ${res.status}`;
        throw new Error(message);
      }
      return data;
    }

    async function loadMessages() {
      if (!state.authenticated) {
        statusEl.textContent = "请输入 gateway token 后连接。";
        updateAuthUi();
        return;
      }
      setBusy(true, "加载会话...");
      try {
        const data = await api(`/api/messages?session=${encodeURIComponent(state.session)}`);
        renderMessages(data.messages || []);
        statusEl.textContent = `已加载 ${state.session}`;
        logProcess("会话已加载", `session=${state.session}`);
      } catch (err) {
        statusEl.textContent = `加载失败: ${err.message}`;
        logProcess("会话加载失败", err.message);
      } finally {
        setBusy(false, statusEl.textContent);
      }
    }

    function stopWakeDebugPolling() {
      if (state.wakeDebugTimer) clearInterval(state.wakeDebugTimer);
      state.wakeDebugTimer = null;
    }

    async function pollWakeDebug() {
      if (!state.authenticated || !state.clientId || !state.wakeEnabled) return;
      try {
        const data = await api(`/api/debug/last?clientId=${encodeURIComponent(state.clientId)}&session=${encodeURIComponent(state.session || "")}`);
        const items = Array.isArray(data.items) ? data.items : [];
        const wake = [...items].reverse().find((item) => item.event === "wake_response");
        if (!wake || (Date.now() - Number(wake.ts || 0) > 10000)) {
          state.lastWakeProbe = null;
          renderPipeline();
          return;
        }
        state.lastWakeProbe = {
          ts: wake.ts,
          engine: wake.engine,
          matched: !!wake.matched,
          text: wake.text || "",
          wakePhrase: wake.wakePhrase || state.wakePhrase,
          requestId: wake.requestId || "",
          bytes: wake.bytes || 0,
        };
        renderPipeline();
      } catch {}
    }

    function startWakeDebugPolling() {
      stopWakeDebugPolling();
      if (!state.authenticated || !state.wakeEnabled) return;
      state.wakeDebugTimer = setInterval(() => {
        void pollWakeDebug();
      }, 1200);
      void pollWakeDebug();
    }

    async function connectWithToken(token) {
      state.authToken = (token || "").trim();
      tokenInputEl.value = state.authToken;
      if (!state.authToken) {
        state.authenticated = false;
        updateAuthUi();
        statusEl.textContent = "请输入 gateway token。";
        return;
      }
      setBusy(true, "正在校验 gateway token...");
      try {
        await api("/api/auth/check");
        state.authenticated = true;
        sessionStore.setItem("openclaw-webchat-auth-token", state.authToken);
        updateAuthUi();
        statusEl.textContent = "已连接";
        logProcess("通过 gateway token 连接", `clientId=${state.clientId}`);
        await loadMessages();
        await enterStandby(`已连接，等待唤醒词：${state.wakePhrase}`);
      } catch (err) {
        state.authenticated = false;
        updateAuthUi();
        statusEl.textContent = `认证失败: ${err.message}`;
        stopWakeDebugPolling();
      } finally {
        setBusy(false, statusEl.textContent);
      }
    }

    async function sendMessage(message, opts = {}) {
      const text = (message || draftEl.value).trim();
      if (!text || state.busy) return;
      const requestId = opts.requestId || state.currentRequestId || makeId("chat");
      draftEl.value = "";
      addMessage("user", text);
      addMessage("system", "处理中...");
      setBusy(true, "OpenClaw 正在回复...");
      state.pendingTranscript = "";
      setStep("claw", "active", `文本已经送进 OpenClaw，等待回复\nrequestId=${requestId}`);
      logProcess("送进 OpenClaw", `${text}\nclientId=${state.clientId}\nrequestId=${requestId}\nsession=${state.session}`);
      try {
        const data = await api("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": state.clientId,
            "X-Request-Id": requestId,
            "X-Session-Key": state.session,
          },
          body: JSON.stringify({ session: state.session, message: text }),
        });
        await ensureVisibleStep("claw", 900);
        renderMessages(data.messages || []);
        state.lastAssistantReply = data.reply || "";
        statusEl.textContent = "已完成";
        setStep("claw", "done", `runId=${data.runId || "unknown"}\nrequestId=${requestId}`);
        logProcess("OpenClaw 回复完成", `${data.reply || ""}\nclientId=${state.clientId}\nrequestId=${requestId}`);
        if (state.autoTts && data.reply) {
          await synthesizeReplyAudio(data.reply, requestId);
        }
        state.currentRequestId = "";
      } catch (err) {
        statusEl.textContent = `发送失败: ${err.message}`;
        setStep("claw", "error", `${err.message}\nrequestId=${requestId}`);
        logProcess("OpenClaw 回复失败", `${err.message}\nclientId=${state.clientId}\nrequestId=${requestId}`);
        await loadMessages();
      } finally {
        if (state.wakeEnabled && state.authenticated && !state.recording && !state.autoTts) scheduleWakeResume(900);
        setBusy(false, statusEl.textContent);
      }
    }

    async function synthesizeReplyAudio(text, requestId) {
      setStep("tts", "active", `mode=${state.ttsMode}\nvoice=${state.ttsVoice}\nrequestId=${requestId}`);
      logProcess("开始合成回复语音", `${text}\nmode=${state.ttsMode}\nvoice=${state.ttsVoice}\nrequestId=${requestId}`);
      try {
        const data = await api("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": state.clientId,
            "X-Request-Id": requestId,
            "X-Session-Key": state.session,
          },
          body: JSON.stringify({
            text,
            mode: state.ttsMode,
            voice: state.ttsVoice,
            session: state.session,
          }),
        });
        await ensureVisibleStep("tts", 700);
        state.lastTts = data.audio || null;
        setStep("tts", "done", `mode=${data.audio?.mode || state.ttsMode}\nvoice=${data.audio?.voice || state.ttsVoice}\nrequestId=${requestId}`);
        logProcess("回复语音完成", `${data.audio?.filename || ""}\nprovider=${data.audio?.provider || ""}\nmode=${data.audio?.mode || state.ttsMode}\nrequestId=${requestId}`);
        renderPipeline();
        if (ttsProofAudioEl) {
          ttsProofAudioEl.pause();
          ttsProofAudioEl.currentTime = 0;
          void ttsProofAudioEl.play().then(() => {
            if (state.wakeEnabled) updateWakeUi("回复播放中，结束后自动回到待机");
          }).catch(() => {
            if (state.wakeEnabled && state.authenticated && !state.recording) scheduleWakeResume(1200);
          });
        }
      } catch (err) {
        setStep("tts", "error", `${err.message}\nrequestId=${requestId}`);
        logProcess("回复语音失败", `${err.message}\nrequestId=${requestId}`);
        if (state.wakeEnabled && state.authenticated && !state.recording) scheduleWakeResume(1200);
      }
    }

    async function transcribeBlob(blob, filename, opts = {}) {
      setBusy(true, "音频转写中...");
      const requestId = opts.requestId || state.currentRequestId || makeId("tx");
      state.currentRequestId = requestId;
      state.lastUpload = null;
      try {
        const kb = Math.round((blob.size || 0) / 1024);
        statusEl.textContent = `上传音频到服务器 (${kb} KB)...`;
        setStep("upload", "active", `${filename} / ${kb} KB\nrequestId=${requestId}`);
        logProcess("上传到服务器", `${filename} / ${kb} KB\nclientId=${state.clientId}\nrequestId=${requestId}\nsession=${state.session}`);
        const data = await api("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": blob.type || "application/octet-stream",
            "X-Filename": filename || "audio.wav",
            "X-ASR-Language": state.transcriptLanguage || "zh",
            "X-Client-Id": state.clientId,
            "X-Request-Id": requestId,
            "X-Session-Key": state.session,
          },
          body: blob,
        });
        await ensureVisibleStep("transcribe", 700);
        state.lastUpload = data.upload || null;
        state.pendingTranscript = data.text || "";
        draftEl.value = state.pendingTranscript;
        statusEl.textContent = `转写完成，请确认文本后再发送：${data.text}`;
        setStep("upload", "done", `${filename} 已上传\nrequestId=${requestId}`);
        setStep("transcribe", "done", `requested=${state.transcriptLanguage} / detected=${data.meta?.language || "unknown"}\nrequestId=${requestId}`);
        setStep("transcript", "done", `${data.text || "[empty]"}\nrequestId=${requestId}`);
        logProcess("服务器转写完成", `${data.text || "[empty]"}\nclientId=${state.clientId}\nrequestId=${requestId}\nuploadId=${data.upload?.id || "unknown"}\nsha256=${data.upload?.sha256 || "unknown"}`);
        setBusy(false, statusEl.textContent);
        const shouldAutoSend = opts.autoSendOverride === true || state.autoSend;
        if (shouldAutoSend) await sendMessage(data.text || "", {requestId});
        else if (state.wakeEnabled && state.authenticated) scheduleWakeResume(1800);
      } catch (err) {
        statusEl.textContent = `转写失败: ${err.message}`;
        setStep("upload", "done", `${filename} 已上传\nrequestId=${requestId}`);
        setStep("transcribe", "error", `${err.message}\nrequestId=${requestId}`);
        logProcess("服务器转写失败", `${err.message}\nclientId=${state.clientId}\nrequestId=${requestId}`);
        setBusy(false, statusEl.textContent);
        if (state.wakeEnabled && state.authenticated) scheduleWakeResume(1800);
      }
    }

    async function cleanupRecording() {
      if (state.meterTimer) cancelAnimationFrame(state.meterTimer);
      state.meterTimer = null;
      if (state.monitorSource) {
        try { state.monitorSource.disconnect(); } catch {}
      }
      if (state.analyser) {
        try { state.analyser.disconnect(); } catch {}
      }
      if (state.monitorContext) {
        try { await state.monitorContext.close(); } catch {}
      }
      state.monitorContext = null;
      state.monitorSource = null;
      state.analyser = null;
      state.inputLevel = 0;
      renderInputLevel();
      if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
      state.mediaRecorder = null;
      state.mediaChunks = [];
      state.recording = false;
      state.currentRecordAutoSend = false;
      state.currentRecordWakeTriggered = false;
      state.autoStopOnSilence = false;
      state.recordStartedAt = 0;
      state.speechSeenAt = 0;
      state.silenceSince = 0;
      state.stopRequested = false;
      recordBtn.textContent = "开始录音";
      updateWakeUi();
    }

    async function stopRecordingAndUpload() {
      if (!state.recording) return;
      if (state.stopRequested && !state.mediaRecorder) return;
      state.recording = false;
      recordBtn.disabled = true;
      recordBtn.textContent = "处理中...";
      const recorder = state.mediaRecorder;
      if (!recorder) {
        await cleanupRecording();
        recordBtn.disabled = false;
        setStep("record", "error", "录音器不存在");
        logProcess("录音失败", "录音器不存在");
        return;
      }
      const stopped = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", (event) => reject(event.error || new Error("MediaRecorder error")), { once: true });
      });
      recorder.stop();
      try {
        await stopped;
        const blob = new Blob(state.mediaChunks, { type: recorder.mimeType || "audio/webm" });
        const sizeKb = Math.round((blob.size || 0) / 1024);
        const requestId = makeId("tx");
        if (state.localCapture?.url) URL.revokeObjectURL(state.localCapture.url);
        state.localCapture = {
          requestId,
          bytes: blob.size || 0,
          mimeType: blob.type || "audio/webm",
          url: URL.createObjectURL(blob),
        };
        await cleanupRecording();
        recordBtn.disabled = false;
        statusEl.textContent = `录音完成，准备上传浏览器原始录音 (${sizeKb} KB, ${blob.type || "unknown"})`;
        setStep("record", "done", `${sizeKb} KB / ${blob.type || "unknown"}`);
        setStep("upload", "active", "等待浏览器开始上传");
        setStep("transcribe", "active", "服务器收到音频后会开始转写");
        logProcess("录音完成", `${sizeKb} KB / ${blob.type || "unknown"}\nrequestId=${requestId}`);
        renderPipeline();
        const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "bin";
        await transcribeBlob(blob, `recording-${Date.now()}.${ext}`, { requestId, autoSendOverride: state.currentRecordAutoSend });
      } catch (err) {
        await cleanupRecording();
        recordBtn.disabled = false;
        statusEl.textContent = `录音停止失败: ${err.message || err}`;
        setStep("record", "error", String(err.message || err));
        logProcess("录音停止失败", String(err.message || err));
      }
    }

    async function startRecording(opts = {}) {
      if (state.recording) {
        await stopRecordingAndUpload();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        statusEl.textContent = "当前浏览器不支持录音。";
        return;
      }
      if (!window.MediaRecorder) {
        statusEl.textContent = "当前浏览器不支持 MediaRecorder 录音。";
        return;
      }
      try {
        await stopWakeListener();
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: state.selectedDeviceId ? { exact: state.selectedDeviceId } : undefined,
            channelCount: 1,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        await refreshMicDevices();
        startLevelMonitor(state.stream);
        const mimeCandidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
          "audio/mp4",
        ];
        const mimeType = mimeCandidates.find((mime) => MediaRecorder.isTypeSupported?.(mime)) || "";
        state.mediaChunks = [];
        state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
        state.mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size > 0) state.mediaChunks.push(event.data);
        });
        state.mediaRecorder.start();
        state.recording = true;
        state.currentRecordAutoSend = !!opts.autoSend;
        state.currentRecordWakeTriggered = !!opts.wakeDetectedText;
        state.autoStopOnSilence = !!opts.autoStopOnSilence;
        state.recordStartedAt = Date.now();
        state.speechSeenAt = 0;
        state.silenceSince = 0;
        state.stopRequested = false;
        recordBtn.textContent = "停止录音";
        statusEl.textContent = state.currentRecordWakeTriggered
          ? `已唤醒，正在录音（${state.mediaRecorder.mimeType || "default"}）。说完后会自动发送。`
          : `录音中（${state.mediaRecorder.mimeType || "default"}）。先看右侧输入电平条是否波动；有波动再继续。`;
        resetProcess("录音已经开始");
        const recordDetail = `${state.mediaRecorder.mimeType || "default"}${state.autoStopOnSilence ? "\n自动停录已开启" : ""}${state.currentRecordAutoSend ? "\n本轮将自动发送" : ""}`;
        setStep("record", "active", recordDetail);
        logProcess("开始录音", `浏览器原始录音格式 ${state.mediaRecorder.mimeType || "default"}\nselectedDeviceId=${state.selectedDeviceId || "default"}${opts.wakeDetectedText ? `\n唤醒词=${opts.wakeDetectedText}` : ""}`);
        updateWakeUi();
      } catch (err) {
        await cleanupRecording();
        statusEl.textContent = `录音失败: ${err.message}`;
        setStep("record", "error", err.message);
        logProcess("录音失败", err.message);
      }
    }

    sendBtn.addEventListener("click", () => sendMessage());
    draftEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        sendMessage();
      }
    });
    recordBtn.addEventListener("click", () => startRecording());
    uploadBtn.addEventListener("click", () => audioInput.click());
    authBtnEl.addEventListener("click", () => connectWithToken(tokenInputEl.value));
    tokenInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        connectWithToken(tokenInputEl.value);
      }
    });
    micSelectEl.addEventListener("change", () => {
      state.selectedDeviceId = micSelectEl.value || "";
      sessionStore.setItem("openclaw-webchat-mic-device", state.selectedDeviceId);
      logProcess("切换麦克风设备", state.selectedDeviceId || "default");
    });
    refreshMicsBtn.addEventListener("click", () => refreshMicDevices());
    wakeToggleEl.addEventListener("change", async () => {
      state.wakeEnabled = !!wakeToggleEl.checked;
      if (state.wakeEnabled) {
        state.lastWakeProbe = null;
        logProcess("开启唤醒词", `${state.wakePhrase}\nclientId=${state.clientId}`);
        await enterStandby(`待机中，等待唤醒词：${state.wakePhrase}`);
      } else {
        logProcess("关闭唤醒词", `clientId=${state.clientId}`);
        stopWakeDebugPolling();
        state.lastWakeProbe = null;
        await stopWakeListener();
      }
      updateWakeUi();
      renderPipeline();
    });
    wakePhraseInputEl.addEventListener("change", async () => {
      state.wakePhrase = (wakePhraseInputEl.value || "你好").trim() || "你好";
      localStorage.setItem("openclaw-webchat-wake-phrase", state.wakePhrase);
      logProcess("更新唤醒词", `${state.wakePhrase}\nclientId=${state.clientId}`);
      if (state.wakeEnabled) {
        await stopWakeListener();
        await startWakeListener();
      } else {
        updateWakeUi();
      }
    });
    languageSelectEl.addEventListener("change", () => {
      state.transcriptLanguage = languageSelectEl.value || "zh";
      localStorage.setItem("openclaw-webchat-language", state.transcriptLanguage);
      logProcess("切换转写语言", `${state.transcriptLanguage}\nclientId=${state.clientId}`);
      if (state.wakeEnabled) {
        void stopWakeListener().then(() => startWakeListener());
      }
    });
    autoSendToggleEl.addEventListener("change", () => {
      state.autoSend = !!autoSendToggleEl.checked;
      localStorage.setItem("openclaw-webchat-auto-send", state.autoSend ? "1" : "0");
      logProcess("切换自动发送", `${state.autoSend ? "on" : "off"}\nclientId=${state.clientId}`);
    });
    ttsModeSelectEl.addEventListener("change", () => {
      state.ttsMode = ttsModeSelectEl.value || "api";
      localStorage.setItem("openclaw-webchat-tts-mode", state.ttsMode);
      logProcess("切换回复语音模式", `${state.ttsMode}\nclientId=${state.clientId}`);
    });
    ttsVoiceSelectEl.addEventListener("change", () => {
      state.ttsVoice = ttsVoiceSelectEl.value || "zh-CN-XiaoxiaoNeural";
      localStorage.setItem("openclaw-webchat-tts-voice", state.ttsVoice);
      logProcess("切换回复语音", `${state.ttsVoice}\nclientId=${state.clientId}`);
    });
    autoTtsToggleEl.addEventListener("change", () => {
      state.autoTts = !!autoTtsToggleEl.checked;
      localStorage.setItem("openclaw-webchat-auto-tts", state.autoTts ? "1" : "0");
      logProcess("切换自动回复语音", `${state.autoTts ? "on" : "off"}\nclientId=${state.clientId}`);
    });
    audioInput.addEventListener("change", async () => {
      const file = audioInput.files && audioInput.files[0];
      audioInput.value = "";
      if (!file) return;
      await transcribeBlob(file, file.name || `upload-${Date.now()}`);
    });
    reloadBtn.addEventListener("click", loadMessages);
    newSessionBtn.addEventListener("click", () => {
      setSession(makeSession());
      renderMessages([]);
      statusEl.textContent = `已切换到 ${state.session}`;
      logProcess("切换到新会话", state.session);
      void pollWakeDebug();
      void enterStandby(`新会话待机，等待唤醒词：${state.wakePhrase}`);
    });
    sessionEl.addEventListener("change", () => {
      const next = sessionEl.value.trim();
      if (!next) return;
      setSession(next);
      logProcess("切换会话", next);
      void pollWakeDebug();
      loadMessages().then(() => enterStandby(`会话已切换，等待唤醒词：${state.wakePhrase}`));
    });

    const initial = qsSession() || sessionStore.getItem("openclaw-webchat-session") || makeSession();
    const initialToken = new URL(window.location.href).searchParams.get("token") || sessionStore.getItem("openclaw-webchat-auth-token") || "";
    const savedLanguage = localStorage.getItem("openclaw-webchat-language");
    state.transcriptLanguage = savedLanguage || (((navigator.language || "").toLowerCase().startsWith("zh")) ? "zh" : "auto");
    state.autoSend = localStorage.getItem("openclaw-webchat-auto-send") === "1";
    state.autoTts = localStorage.getItem("openclaw-webchat-auto-tts") !== "0";
    state.ttsMode = localStorage.getItem("openclaw-webchat-tts-mode") || "api";
    state.ttsVoice = localStorage.getItem("openclaw-webchat-tts-voice") || "zh-CN-XiaoxiaoNeural";
    state.wakeEnabled = true;
    const storedWakePhrase = localStorage.getItem("openclaw-webchat-wake-phrase") || "";
    state.wakePhrase = (!storedWakePhrase || storedWakePhrase === "hey robot" || storedWakePhrase === "机器人你好") ? "你好" : storedWakePhrase;
    state.wakeSupported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    state.clientId = localStorage.getItem("openclaw-webchat-client-id") || makeId("client");
    state.selectedDeviceId = sessionStore.getItem("openclaw-webchat-mic-device") || "";
    localStorage.setItem("openclaw-webchat-client-id", state.clientId);
    languageSelectEl.value = state.transcriptLanguage;
    autoSendToggleEl.checked = state.autoSend;
    ttsModeSelectEl.value = state.ttsMode;
    ttsVoiceSelectEl.value = state.ttsVoice;
    autoTtsToggleEl.checked = state.autoTts;
    wakeToggleEl.checked = state.wakeEnabled;
    wakePhraseInputEl.value = state.wakePhrase;
    tokenInputEl.value = initialToken;
    renderInputLevel();
    updateAuthUi();
    updateWakeUi();
    refreshMicDevices();
    setSession(initial);
    resetProcess("页面已就绪");
    logProcess("页面已就绪", `clientId=${state.clientId}\nsession=${initial}\nlanguage=${state.transcriptLanguage}\nautoSend=${state.autoSend}\nautoTts=${state.autoTts}\nttsVoice=${state.ttsVoice}`);
    if (initialToken) {
      connectWithToken(initialToken);
    } else {
      statusEl.textContent = "请输入 gateway token 后连接。";
    }
    ttsProofAudioEl.addEventListener("ended", () => {
      if (state.wakeEnabled && state.authenticated && !state.recording) {
        updateWakeUi("回复结束，回到待机");
        scheduleWakeResume(400);
      }
    });
  </script>
</body>
</html>
'''


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Permissions-Policy", "microphone=(self)")
    handler.end_headers()
    handler.wfile.write(body)


def html_response(handler, html_text):
    body = html_text.encode("utf-8")
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Permissions-Policy", "microphone=(self)")
    handler.end_headers()
    handler.wfile.write(body)

# 把 session 清洗成安全文件名。
def sanitize_session(raw):
    session = (raw or "").strip()[:120]
    if not session:
        session = f"web-{int(time.time())}"
    session = re.sub(r"[^A-Za-z0-9:_-]", "-", session)
    return session

# 把 session 映射到 DATA_DIR/<session>.json
def session_file(session):
    return DATA_DIR / f"{session}.json"

# 读整个会话消息列表。
def load_messages(session):
    path = session_file(session)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

# 把整个列表写回磁盘。
def save_messages(session, messages):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    session_file(session).write_text(json.dumps(messages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# 加一条消息并保存。
def payload_bool(payload, name, default=True):
    value = payload.get(name, default) if isinstance(payload, dict) else default
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def append_message(session, role, content):
    with LOCK:
        messages = load_messages(session)
        messages.append({"role": role, "content": content, "ts": int(time.time() * 1000)})
        save_messages(session, messages)
        return messages


def build_knowledge_augmented_message(message, knowledge_enabled=True):
    if not knowledge_enabled:
        return message, {
            "enabled": False,
            "disabled_by_request": True,
            "citations": [],
        }
    kb_context, kb_citations = KNOWLEDGE_SERVICE.build_prompt_context(message)
    if not kb_context:
        return message, {"enabled": bool(KNOWLEDGE_SERVICE.status().get("enabled")), "citations": []}
    augmented = (
        f"{message}\n\n"
        "[Knowledge Base Evidence]\n"
        f"{kb_context}\n\n"
        "Please answer using the evidence above when it is relevant, and mention the source briefly."
    )
    return augmented, {"enabled": True, "citations": kb_citations}


def run_openclaw(session, message, knowledge_enabled=True):
    message, knowledge_meta = build_knowledge_augmented_message(message, knowledge_enabled=knowledge_enabled)
    env = os.environ.copy()
    env.setdefault("VLLM_API_KEY", "vllm-local")
    cmd = [OPENCLAW_BIN, "agent", "--agent", AGENT_ID, "--session-id", session, "--message", message, "--timeout", "180", "--json"]
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=240)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"openclaw failed: {proc.returncode}")
    parsed = json.loads(proc.stdout)
    payloads = (((parsed.get("result") or {}).get("payloads")) or [])
    reply = "\n\n".join(str(p.get("text", "")).strip() for p in payloads if isinstance(p, dict) and p.get("text")) or "[empty reply]"
    parsed["knowledge"] = knowledge_meta
    return reply.strip(), parsed


def run_fast_llm(session, message, knowledge_enabled=True):
    history = load_messages(session)[-(FAST_HISTORY_TURNS * 2):] if FAST_HISTORY_TURNS > 0 else []
    if knowledge_enabled:
        kb_context, kb_citations = KNOWLEDGE_SERVICE.build_prompt_context(message)
    else:
        kb_context, kb_citations = "", []
    messages = [{
        "role": "system",
        "content": (
            "你是空管智能语音工作台的快速对话助手。"
            "优先用中文直接回答，默认不超过80个汉字；"
            "如果用户问空管指令，先给结论，再给必要字段。"
        ),
    }]
    if kb_context:
        messages.append({
            "role": "system",
            "content": (
                "Use the following retrieved knowledge as grounding evidence. "
                "If it is relevant, answer from it and mention the source briefly.\n\n"
                f"{kb_context}"
            ),
        })
    for item in history:
        role = item.get("role")
        content = str(item.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content[:500]})
    messages.append({"role": "user", "content": message})
    payload = {
        "model": FAST_LLM_MODEL,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": FAST_LLM_MAX_TOKENS,
        "stream": False,
    }
    req = urllib.request.Request(
        FAST_LLM_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {FAST_LLM_API_KEY}",
        },
        method="POST",
    )
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=FAST_LLM_TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    choice = (data.get("choices") or [{}])[0]
    reply = str(((choice.get("message") or {}).get("content")) or "").strip()
    if not reply:
        reply = "[empty fast reply]"
    return reply, {
        "mode": "fast-direct-vllm",
        "model": FAST_LLM_MODEL,
        "elapsedMs": elapsed_ms,
        "usage": data.get("usage"),
        "knowledge": {
            "enabled": bool(KNOWLEDGE_SERVICE.status().get("enabled")) and bool(knowledge_enabled),
            "disabled_by_request": not bool(knowledge_enabled),
            "citations": kb_citations,
        },
    }


def run_chat_backend(session, message, knowledge_enabled=True):
    if FAST_MODE:
        return run_fast_llm(session, message, knowledge_enabled=knowledge_enabled)
    return run_openclaw(session, message, knowledge_enabled=knowledge_enabled)


def ext_for_content_type(content_type, filename):
    if filename and "." in filename:
        return pathlib.Path(filename).suffix[:10]
    content_type = (content_type or "").split(";")[0].strip().lower()
    mapping = {
        "audio/webm": ".webm",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/mp4": ".m4a",
        "audio/aac": ".aac",
        "audio/flac": ".flac",
        "audio/x-flac": ".flac",
        "audio/ogg": ".ogg",
    }
    return mapping.get(content_type, ".bin")


def transcribe_via_asr_service(path, *, vad_filter=False, language=None):
    payload = {"path": str(path), "vad_filter": vad_filter}
    if language:
        payload["language"] = language
    req = urllib.request.Request(
        ASR_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = str(data.get("text") or "").strip()
    return text, data


def transcribe_audio(raw_bytes, content_type, filename, requested_language=None):
    if not raw_bytes:
        raise RuntimeError("empty audio payload")
    if len(raw_bytes) > MAX_AUDIO_BYTES:
        raise RuntimeError(f"audio too large: {len(raw_bytes)} bytes")
    with tempfile.TemporaryDirectory(prefix="openclaw-webchat-") as tmp:
        path = pathlib.Path(tmp) / f"audio{ext_for_content_type(content_type, filename)}"
        path.write_bytes(raw_bytes)
        requested = None if requested_language in (None, "", "auto") else requested_language
        transcript, meta = transcribe_via_asr_service(path, vad_filter=False, language=requested)
        if not transcript and requested is not None:
            transcript, meta = transcribe_via_asr_service(path, vad_filter=False)
        if not transcript and requested not in ("zh",) and path.suffix.lower() != ".wav":
            transcript, meta = transcribe_via_asr_service(path, vad_filter=False, language="zh")
        if not transcript:
            raise RuntimeError(f"empty transcript ({content_type or 'unknown'}, {len(raw_bytes)} bytes)")
        return transcript, meta


def normalize_chinese_text(text):
    if not text:
        return text
    normalized = text.strip()
    replacements = {
        ",": "，",
        ".": "。",
        "?": "？",
        "!": "！",
        ":": "：",
        ";": "；",
        "(": "（",
        ")": "）",
    }
    for src, dst in replacements.items():
        normalized = normalized.replace(src, dst)
    normalized = re.sub(r"\s+", "", normalized)
    return normalized


def normalize_wake_text(text):
    phonetic_aliases = {
        "0": "dong", "零": "dong", "〇": "dong", "洞": "dong",
        "动": "dong", "動": "dong", "栋": "dong", "棟": "dong", "冬": "dong", "冻": "dong",
        "1": "yao", "幺": "yao", "妖": "yao", "腰": "yao", "要": "yao",
        "2": "liang", "两": "liang", "俩": "liang", "辆": "liang",
        "3": "san", "三": "san", "叁": "san", "山": "san",
        "4": "si", "四": "si", "肆": "si", "是": "si", "寺": "si",
        "5": "wu", "五": "wu", "伍": "wu", "物": "wu",
        "6": "liu", "六": "liu", "陆": "liu", "溜": "liu",
        "7": "guai", "拐": "guai", "怪": "guai",
        "8": "ba", "八": "ba", "捌": "ba",
        "9": "jiu", "九": "jiu", "玖": "jiu",
    }
    try:
        from pypinyin import lazy_pinyin
    except Exception:
        lazy_pinyin = None
    compact = re.sub(r"[\s\W_]+", "", str(text or "").lower(), flags=re.UNICODE)
    tokens = []
    for char in compact:
        mapped = phonetic_aliases.get(char)
        if mapped is not None:
            tokens.append(mapped)
        elif lazy_pinyin is not None and "\u4e00" <= char <= "\u9fff":
            tokens.extend(lazy_pinyin(char, errors="default"))
        else:
            tokens.append(char)
    return "".join(tokens)


def try_transcribe_audio(raw_bytes, content_type, filename, requested_language=None):
    try:
        return transcribe_audio(raw_bytes, content_type, filename, requested_language=requested_language)
    except Exception as exc:
        if "empty transcript" in str(exc).lower():
            return "", {"language": requested_language or "unknown"}
        raise


def check_wake_with_sherpa(raw_bytes, wake_phrase):
    req = urllib.request.Request(
        SHERPA_WAKE_URL,
        data=raw_bytes,
        headers={
            "Content-Type": "audio/wav",
            "X-Wake-Phrase": wake_phrase,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def save_upload(raw_bytes, content_type, filename):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "-", filename or "audio.bin")[:120] or "audio.bin"
    stem = pathlib.Path(safe_name).stem or "audio"
    suffix = pathlib.Path(safe_name).suffix or ext_for_content_type(content_type, safe_name)
    upload_id = f"upl-{int(time.time() * 1000)}-{os.urandom(3).hex()}"
    stored_name = f"{upload_id}-{stem}{suffix}"
    path = UPLOAD_DIR / stored_name
    path.write_bytes(raw_bytes)
    sha256 = hashlib.sha256(raw_bytes).hexdigest()
    return {
        "id": upload_id,
        "filename": safe_name,
        "storedName": stored_name,
        "path": str(path),
        "bytes": len(raw_bytes),
        "sha256": sha256,
        "url": f"/api/uploads/{urllib.parse.quote(stored_name)}",
    }


def save_tts_file(path, *, request_id, voice, client_id, session):
    TTS_DIR.mkdir(parents=True, exist_ok=True)
    src = pathlib.Path(path)
    ext = src.suffix or ".mp3"
    file_id = f"tts-{int(time.time() * 1000)}-{os.urandom(3).hex()}"
    stored_name = f"{file_id}-{request_id}{ext}"
    target = TTS_DIR / stored_name
    target.write_bytes(src.read_bytes())
    return {
        "id": file_id,
        "requestId": request_id,
        "voice": voice,
        "provider": "microsoft",
        "filename": stored_name,
        "bytes": target.stat().st_size,
        "path": str(target),
        "clientId": client_id,
        "session": session,
        "url": f"/api/tts-files/{urllib.parse.quote(stored_name)}",
    }


def synthesize_tts_api(text, *, voice, request_id, client_id, session):
    TTS_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="openclaw-webchat-tts-") as tmp:
        out = pathlib.Path(tmp) / "reply.mp3"
        script = (
            "import asyncio, edge_tts\n"
            f"async def main():\n"
            f"    communicate = edge_tts.Communicate({text!r}, {voice!r})\n"
            f"    await communicate.save({str(out)!r})\n"
            "asyncio.run(main())\n"
        )
        env = os.environ.copy()
        pydeps = COSYVOICE_PYDEPS
        env["PYTHONPATH"] = pydeps + (":" + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        cmd = [OPENCLAW_PYTHON, "-c", script]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"edge-tts failed: {proc.returncode}")
        meta = {"provider": "microsoft-edge-tts", "voice": voice}
        if not out.exists():
            raise RuntimeError("tts output missing")
        audio = save_tts_file(out, request_id=request_id, voice=voice, client_id=client_id, session=session)
        audio["provider"] = "microsoft"
        audio["mode"] = "api"
        return audio, meta


def synthesize_tts_cosyvoice(text, *, request_id, client_id, session):
    req = urllib.request.Request(
        COSYVOICE_TTS_URL,
        data=json.dumps({"text": text, "request_id": request_id}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    out = pathlib.Path(data["path"])
    if not out.exists():
        raise RuntimeError("cosyvoice output missing")
    voice_label = f"CosyVoice Local ({data.get('speaker') or data.get('model_kind') or 'default'})"
    audio = save_tts_file(out, request_id=request_id, voice=voice_label, client_id=client_id, session=session)
    audio["provider"] = "cosyvoice-local"
    audio["mode"] = "cosyvoice"
    return audio, data


def filter_debug_items(items, *, client_id=None, session=None, request_id=None):
    result = items
    if client_id:
        result = [item for item in result if str(item.get("clientId") or "") == client_id]
    if session:
        result = [item for item in result if str(item.get("session") or item.get("sessionKey") or "") == session]
    if request_id:
        result = [item for item in result if str(item.get("requestId") or "") == request_id]
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenClawWebChat/1.1"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def serve_audio_file(self, path, mime, *, head_only=False):
        size = path.stat().st_size
        range_header = (self.headers.get("Range") or "").strip()
        start = 0
        end = size - 1
        status = HTTPStatus.OK
        if range_header.startswith("bytes="):
            spec = range_header.split("=", 1)[1].split(",", 1)[0].strip()
            left, _, right = spec.partition("-")
            try:
                if left:
                    start = int(left)
                    end = int(right) if right else size - 1
                elif right:
                    suffix = int(right)
                    start = max(0, size - suffix)
                    end = size - 1
                if start < 0 or end < start or start >= size:
                    self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.end_headers()
                    return
                end = min(end, size - 1)
                status = HTTPStatus.PARTIAL_CONTENT
            except ValueError:
                start = 0
                end = size - 1
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if head_only:
            return
        with path.open("rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(1024 * 256, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if not require_auth(self, parsed):
            return
        if parsed.path.startswith("/api/tts-files/"):
            name = pathlib.Path(urllib.parse.unquote(parsed.path.split("/api/tts-files/", 1)[1])).name
            path = TTS_DIR / name
            if not path.exists() or not path.is_file():
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "tts_not_found"})
                return
            mime = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg"}.get(path.suffix.lower(), "application/octet-stream")
            self.serve_audio_file(path, mime, head_only=True)
            return
        json_response(self, HTTPStatus.NOT_FOUND, {"error": f"not found: {parsed.path}"})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        # 返回页面
        if parsed.path in ("/", "/chat"):
            html_response(self, load_frontend_text("index.html", INDEX_HTML))
            return
        # Serve copied frontend assets, including ES modules and images.
        if parsed.path.startswith("/static/"):
            rel = parsed.path[len("/static/"):]
            if not rel:
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            target = (FRONTEND_DIR / rel).resolve()
            root = FRONTEND_DIR.resolve()
            if target != root and root not in target.parents:
                json_response(self, HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            ext = target.suffix.lower()
            content_type = {
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".mjs": "application/javascript; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".html": "text/html; charset=utf-8",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".svg": "image/svg+xml",
                ".webp": "image/webp",
                ".ico": "image/x-icon",
            }.get(ext, "application/octet-stream")
            static_response(self, target, content_type)
            return
        # 认证检查
        if parsed.path == "/api/auth/check":
            if not require_auth(self, parsed):
                json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            json_response(self, HTTPStatus.OK, {"ok": True})
            return

        # 健康检查
        if parsed.path == "/api/health":
            json_response(self, HTTPStatus.OK, {
                "ok": True,
                "agent": AGENT_ID,
                "port": PORT,
                "fastMode": FAST_MODE,
                "fastLlmUrl": FAST_LLM_URL,
                "fastLlmModel": FAST_LLM_MODEL,
                "fastMaxTokens": FAST_LLM_MAX_TOKENS,
            })
            return
        if not require_auth(self, parsed):
            json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        if parsed.path == "/api/debug/last":
            try:
                lines = LOG_PATH.read_text(encoding="utf-8").splitlines()[-40:] if LOG_PATH.exists() else []
                items = [json.loads(line) for line in lines if line.strip()]
                params = urllib.parse.parse_qs(parsed.query)
                items = filter_debug_items(
                    items,
                    client_id=(params.get("clientId") or [""])[0] or None,
                    session=(params.get("session") or [""])[0] or None,
                    request_id=(params.get("requestId") or [""])[0] or None,
                )
            except Exception as exc:
                items = [{"error": str(exc)}]
            json_response(self, HTTPStatus.OK, {"items": items})
            return
        if parsed.path == "/api/messages":
            params = urllib.parse.parse_qs(parsed.query)
            session = sanitize_session((params.get("session") or [""])[0])
            json_response(self, HTTPStatus.OK, {"session": session, "messages": load_messages(session)})
            return
        if parsed.path == "/api/speaker/status":
            params = urllib.parse.parse_qs(parsed.query)
            speaker_id = (params.get("speaker_id") or [SPEAKER_VERIFIER.default_speaker_id])[0]
            json_response(self, HTTPStatus.OK, SPEAKER_VERIFIER.status(speaker_id))
            return
        if parsed.path == "/api/knowledge/status":
            json_response(self, HTTPStatus.OK, {"ok": True, "knowledge": KNOWLEDGE_SERVICE.status()})
            return
        if parsed.path == "/api/knowledge/visualization":
            json_response(self, HTTPStatus.OK, {"ok": True, "knowledge": KNOWLEDGE_SERVICE.status(), "visualization": KNOWLEDGE_SERVICE.visualization()})
            return
        if parsed.path.startswith("/api/uploads/"):
            name = pathlib.Path(urllib.parse.unquote(parsed.path.split("/api/uploads/", 1)[1])).name
            path = UPLOAD_DIR / name
            if not path.exists() or not path.is_file():
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "upload_not_found"})
                return
            body = path.read_bytes()
            mime = {
                ".wav": "audio/wav",
                ".mp3": "audio/mpeg",
                ".m4a": "audio/mp4",
                ".ogg": "audio/ogg",
                ".flac": "audio/flac",
                ".webm": "audio/webm",
            }.get(path.suffix.lower(), "application/octet-stream")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path.startswith("/api/tts-files/"):
            name = pathlib.Path(urllib.parse.unquote(parsed.path.split("/api/tts-files/", 1)[1])).name
            path = TTS_DIR / name
            if not path.exists() or not path.is_file():
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "tts_not_found"})
                return
            mime = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg"}.get(path.suffix.lower(), "application/octet-stream")
            self.serve_audio_file(path, mime)
            return
        json_response(self, HTTPStatus.NOT_FOUND, {"error": f"not found: {parsed.path}"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length)
        try:
            if not require_auth(self, parsed):
                json_response(self, HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            client_id = self.headers.get("X-Client-Id", "")
            request_id = self.headers.get("X-Request-Id", "")
            session_header = self.headers.get("X-Session-Key", "")
            if parsed.path == "/api/knowledge/search":
                payload = json.loads(raw.decode("utf-8") if raw else "{}")
                query = str(payload.get("query") or payload.get("message") or "").strip()
                mode = str(payload.get("mode") or "").strip() or None
                top_k = payload.get("top_k") or payload.get("topK")
                try:
                    top_k = int(top_k) if top_k is not None else None
                except (TypeError, ValueError):
                    top_k = None
                if not query:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "query is required"})
                    return
                results = KNOWLEDGE_SERVICE.retrieve(query, top_k=top_k, mode=mode)
                json_response(self, HTTPStatus.OK, {
                    "ok": True,
                    "query": query,
                    "knowledge": KNOWLEDGE_SERVICE.status(),
                    "results": results,
                })
                return
            if parsed.path in ("/api/speaker/enroll", "/api/speaker/verify"):
                content_type = self.headers.get("Content-Type")
                filename = self.headers.get("X-Filename", "speaker.wav")
                speaker_id = self.headers.get("X-Speaker-Id", SPEAKER_VERIFIER.default_speaker_id)
                if not raw:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "empty audio payload"})
                    return
                if len(raw) > MAX_AUDIO_BYTES:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"audio too large: {len(raw)} bytes"})
                    return
                with tempfile.TemporaryDirectory(prefix="openclaw-speaker-") as tmp:
                    path = pathlib.Path(tmp) / f"speaker{ext_for_content_type(content_type, filename)}"
                    path.write_bytes(raw)
                    if parsed.path == "/api/speaker/enroll":
                        result = SPEAKER_VERIFIER.enroll(str(path), speaker_id=speaker_id)
                        log_event("speaker_enroll", ok=result.get("ok"), speakerId=result.get("speaker_id"), numSamples=result.get("num_samples"), clientId=client_id, requestId=request_id)
                    else:
                        result = SPEAKER_VERIFIER.verify(str(path), speaker_id=speaker_id)
                        log_event("speaker_verify", ok=result.get("ok"), matched=result.get("matched"), score=result.get("score"), speakerId=result.get("speaker_id"), clientId=client_id, requestId=request_id)
                status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
                json_response(self, status, result)
                return
            if parsed.path == "/api/chat":
                payload = json.loads(raw.decode("utf-8") if raw else "{}")
                session = sanitize_session(payload.get("session"))
                log_event("chat_request", remote=self.client_address[0], bytes=len(raw), clientId=client_id, requestId=request_id, session=session, sessionHeader=session_header)
                message = str(payload.get("message") or "").strip()
                if not message:
                    raise RuntimeError("message is required")
                knowledge_enabled = payload_bool(payload, "knowledgeEnabled", True)
                append_message(session, "user", message)
                chat_start = time.perf_counter()
                reply, meta = run_chat_backend(session, message, knowledge_enabled=knowledge_enabled)
                chat_elapsed_ms = int((time.perf_counter() - chat_start) * 1000)
                messages = append_message(session, "assistant", reply)
                log_event("chat_response", session=session, mode=meta.get("mode"), runId=meta.get("runId"), replyChars=len(reply), elapsedMs=chat_elapsed_ms, clientId=client_id, requestId=request_id)
                json_response(self, HTTPStatus.OK, {
                    "ok": True,
                    "session": session,
                    "reply": reply,
                    "messages": messages,
                    "runId": meta.get("runId"),
                    "mode": meta.get("mode"),
                    "elapsedMs": chat_elapsed_ms,
                    "meta": meta,
                })
                return
            if parsed.path == "/api/transcribe":
                content_type = self.headers.get("Content-Type")
                filename = self.headers.get("X-Filename", "audio.bin")
                requested_language = self.headers.get("X-ASR-Language", "auto")
                upload = save_upload(raw, content_type, filename)
                session = sanitize_session(session_header) if session_header else ""
                upload["clientId"] = client_id
                upload["requestId"] = request_id
                upload["session"] = session
                log_event("transcribe_request", remote=self.client_address[0], bytes=len(raw), contentType=content_type, filename=filename, requestedLanguage=requested_language, uploadId=upload["id"], sha256=upload["sha256"], clientId=client_id, requestId=request_id, session=session)
                transcript, meta = transcribe_audio(raw, content_type, filename, requested_language=requested_language)
                if (requested_language == "zh") or (str(meta.get("language") or "").lower().startswith("zh")):
                    transcript = normalize_chinese_text(transcript)
                    meta["text"] = transcript
                log_event("transcribe_response", bytes=len(raw), filename=filename, textChars=len(transcript), language=meta.get("language"), requestedLanguage=requested_language, uploadId=upload["id"], sha256=upload["sha256"], clientId=client_id, requestId=request_id, session=session)
                json_response(self, HTTPStatus.OK, {"ok": True, "text": transcript, "meta": meta, "upload": upload})
                return
            if parsed.path == "/api/wake-check":
                content_type = self.headers.get("Content-Type")
                filename = self.headers.get("X-Filename", "wake.bin")
                wake_phrase = ""
                wake_phrase_b64 = self.headers.get("X-Wake-Phrase-B64", "")
                if wake_phrase_b64:
                    try:
                        wake_phrase = base64.b64decode(wake_phrase_b64).decode("utf-8")
                    except Exception:
                        wake_phrase = ""
                if not wake_phrase:
                    wake_phrase = self.headers.get("X-Wake-Phrase", "你好")
                requested_language = self.headers.get("X-Wake-Language", "auto")
                speaker_id = self.headers.get("X-Speaker-Id", SPEAKER_VERIFIER.default_speaker_id)
                speaker_match_mode = self.headers.get("X-Speaker-Match-Mode", "all").strip().lower()
                if speaker_match_mode not in ("all", "current"):
                    speaker_match_mode = "all"
                session = sanitize_session(session_header) if session_header else ""
                log_event("wake_request", remote=self.client_address[0], bytes=len(raw), contentType=content_type, filename=filename, wakePhrase=wake_phrase, requestedLanguage=requested_language, speakerId=speaker_id, speakerMatchMode=speaker_match_mode, clientId=client_id, requestId=request_id, session=session)
                def run_wake_task():
                    transcript = ""
                    meta = {"engine": "asr-fallback"}
                    matched = False
                    prefer_sherpa = requested_language == "en"
                    try:
                        if prefer_sherpa:
                            sherpa = check_wake_with_sherpa(raw, wake_phrase)
                            matched = bool(sherpa.get("matched"))
                            transcript = str(sherpa.get("text") or "")
                            meta = {"engine": "sherpa-kws", **sherpa}
                            if not matched:
                                transcript, asr_meta = try_transcribe_audio(raw, content_type, filename, requested_language=requested_language)
                                matched = bool(transcript) and normalize_wake_text(wake_phrase) in normalize_wake_text(transcript)
                                meta = {"engine": "asr-fallback", "sherpa": sherpa, **asr_meta}
                        else:
                            transcript, asr_meta = try_transcribe_audio(raw, content_type, filename, requested_language=requested_language)
                            matched = bool(transcript) and normalize_wake_text(wake_phrase) in normalize_wake_text(transcript)
                            meta = {"engine": "asr-fallback", **asr_meta}
                    except Exception as sherpa_exc:
                        transcript, asr_meta = try_transcribe_audio(raw, content_type, filename, requested_language=requested_language)
                        matched = bool(transcript) and normalize_wake_text(wake_phrase) in normalize_wake_text(transcript)
                        meta = {"engine": "asr-fallback", "fallbackError": str(sherpa_exc), **asr_meta}
                    return {"matched": matched, "wake_matched": bool(matched), "text": transcript, "meta": meta}

                with tempfile.TemporaryDirectory(prefix="openclaw-wake-speaker-") as tmp:
                    speaker_audio = pathlib.Path(tmp) / f"wake{ext_for_content_type(content_type, filename)}"
                    speaker_audio.write_bytes(raw)
                    with ThreadPoolExecutor(max_workers=2) as executor:
                        wake_future = executor.submit(run_wake_task)
                        if speaker_match_mode == "current":
                            speaker_future = executor.submit(SPEAKER_VERIFIER.verify, str(speaker_audio), speaker_id)
                        else:
                            speaker_future = executor.submit(SPEAKER_VERIFIER.verify_any, str(speaker_audio))
                        wake_result = wake_future.result()
                        speaker_result = speaker_future.result()

                transcript = str(wake_result.get("text") or "")
                meta = wake_result.get("meta") or {"engine": "asr-fallback"}
                wake_matched = bool(wake_result.get("matched") or wake_result.get("wake_matched"))
                speaker_matched = bool(speaker_result.get("matched"))
                matched = wake_matched and speaker_matched
                speaker_reason = (
                    speaker_result.get("reason")
                    or speaker_result.get("error")
                    or ("speaker matched" if speaker_matched else "speaker not matched")
                )
                log_event(
                    "wake_response",
                    bytes=len(raw),
                    filename=filename,
                    wakePhrase=wake_phrase,
                    text=transcript,
                    matched=matched,
                    wakeMatched=wake_matched,
                    speakerMatched=speaker_matched,
                    speakerScore=speaker_result.get("score"),
                    speakerThreshold=speaker_result.get("threshold"),
                    speakerEnabled=bool(speaker_result.get("enabled")),
                    speakerId=speaker_result.get("speaker_id"),
                    speakerMatchMode=speaker_match_mode,
                    speakerBackend=speaker_result.get("backend"),
                    speakerModelId=speaker_result.get("model_id"),
                    speakerReason=speaker_reason,
                    speakerError=speaker_result.get("error"),
                    language=meta.get("language"),
                    engine=meta.get("engine"),
                    clientId=client_id,
                    requestId=request_id,
                    session=session,
                )
                json_response(self, HTTPStatus.OK, {
                    "ok": True,
                    "matched": matched,
                    "wake_matched": wake_matched,
                    "speaker_matched": speaker_matched,
                    "speaker_score": speaker_result.get("score"),
                    "speaker_threshold": speaker_result.get("threshold"),
                    "speaker_enabled": bool(speaker_result.get("enabled")),
                    "speaker_id": speaker_result.get("speaker_id"),
                    "speaker_match_mode": speaker_match_mode,
                    "speaker_backend": speaker_result.get("backend"),
                    "speaker_model_id": speaker_result.get("model_id"),
                    "speaker_reason": speaker_reason,
                    "speaker_error": speaker_result.get("error"),
                    "speaker": speaker_result,
                    "text": transcript,
                    "meta": meta,
                })
                return
            if parsed.path == "/api/tts":
                payload = json.loads(raw.decode("utf-8") if raw else "{}")
                text = str(payload.get("text") or "").strip()
                mode = str(payload.get("mode") or "api").strip() or "api"
                voice = str(payload.get("voice") or "zh-CN-XiaoxiaoNeural").strip() or "zh-CN-XiaoxiaoNeural"
                session = sanitize_session(payload.get("session") or session_header) if (payload.get("session") or session_header) else ""
                if not text:
                    raise RuntimeError("tts text is required")
                original_text_chars = len(text)
                if FAST_MODE and FAST_TTS_MAX_CHARS > 0 and len(text) > FAST_TTS_MAX_CHARS:
                    text = text[:FAST_TTS_MAX_CHARS].rstrip("，。,. ") + "。"
                rid = request_id or make_server_id("tts")
                tts_start = time.perf_counter()
                log_event("tts_request", clientId=client_id, requestId=rid, session=session, voice=voice, mode=mode, textChars=len(text), originalTextChars=original_text_chars)
                if mode == "cosyvoice":
                    audio, meta = synthesize_tts_cosyvoice(text, request_id=rid, client_id=client_id, session=session)
                else:
                    audio, meta = synthesize_tts_api(text, voice=voice, request_id=rid, client_id=client_id, session=session)
                tts_elapsed_ms = int((time.perf_counter() - tts_start) * 1000)
                audio["elapsedMs"] = tts_elapsed_ms
                audio["fastTruncated"] = original_text_chars != len(text)
                log_event("tts_response", clientId=client_id, requestId=rid, session=session, voice=audio["voice"], mode=audio["mode"], filename=audio["filename"], bytes=audio["bytes"], elapsedMs=tts_elapsed_ms, fastTruncated=audio["fastTruncated"])
                json_response(self, HTTPStatus.OK, {"ok": True, "audio": audio, "meta": meta})
                return
            json_response(self, HTTPStatus.NOT_FOUND, {"error": f"not found: {parsed.path}"})
        except subprocess.TimeoutExpired:
            log_event("request_timeout", path=parsed.path)
            json_response(self, HTTPStatus.GATEWAY_TIMEOUT, {"error": "request timed out"})
        except Exception as exc:
            log_event("request_error", path=parsed.path, error=str(exc))
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    scheme = "http"
    if TLS_CERT_PATH and TLS_KEY_PATH:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=TLS_CERT_PATH, keyfile=TLS_KEY_PATH)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    print(f"OpenClaw webchat listening on {scheme}://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
