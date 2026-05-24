# Claw Voice Agent

一个本地语音 Agent 项目。

当前主链路：

- 唤醒词进入对话
- 浏览器录音 / 音频上传
- 服务器端 ASR
- 本地 LLM 回复
- 本地 / API 可切换 TTS

## 当前运行格式

当前代码是按下面的结构组织的：

```text
.
├── README.md
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── services/
│   ├── webchat/
│   │   └── server.py
│   ├── wake/
│   │   ├── sherpa_kws_server.py
│   │   └── wake_keywords.txt
│   ├── tts/
│   │   └── cosyvoice_server.py
│   ├── asr/
│   └── agent/
└── deploy/
    ├── config/
    │   └── openclaw.json.example
    └── systemd/
```

## 当前使用的模型和组件

- Agent runtime: `OpenClaw`
- LLM serving: `vLLM`
- LLM model: `Qwen2.5-7B-Instruct`
- ASR model: `faster-whisper large-v3`
- Local TTS model: `CosyVoice-300M-SFT`
- API TTS fallback: `Microsoft edge-tts`
- Wake word:
  - 当前稳定主路径：中文固定词走本地 ASR 唤醒
  - `sherpa-kws` 已接入，继续调优

## 当前服务关系

```text
frontend/
  -> webchat/server.py
  -> /api/wake-check
  -> /api/transcribe
  -> /api/chat
  -> /api/tts
  -> /api/knowledge/status
  -> /api/knowledge/search

/api/wake-check
  -> sherpa-kws
  -> or ASR fallback

/api/transcribe
  -> faster-whisper

/api/chat
  -> OpenClaw
  -> localqwen
  -> vLLM
  -> Qwen2.5-7B-Instruct
  -> optional knowledge_base RAG

/api/tts
  -> CosyVoice-300M-SFT
  -> or Microsoft edge-tts
```

## 知识库 / RAG

本项目已接入 `knowledge_base/` 模块，支持 PDF、DOCX、XLSX、TXT、CSV、MD、JSON、JSONL 等资料构建 FAISS 向量索引和关键词索引。

构建本地知识库：

```bash
python knowledge_base/build_kb.py \
  --source examples/knowledge_base_docs \
  --output .openclaw-kb
```

测试检索：

```bash
python knowledge_base/test_retrieval.py \
  "航空器移交前管制员需要确认哪些信息？" \
  --output .openclaw-kb \
  --mode hybrid
```

WebChat 默认不启用知识库增强。启用后，`/api/chat` 会先执行混合检索，并把候选证据注入到 LLM prompt 中：

```bash
export OPENCLAW_KB_ENABLED=true
export OPENCLAW_KB_OUTPUT_DIR=.openclaw-kb
export OPENCLAW_KB_EMBEDDING_MODEL=shibing624/text2vec-base-chinese
export OPENCLAW_KB_RETRIEVAL_MODE=hybrid
```

独立检索接口：

```text
GET  /api/knowledge/status
POST /api/knowledge/search
```

`/api/knowledge/search` 请求体示例：

```json
{
  "query": "Which airport has the ident KJFK?",
  "mode": "hybrid",
  "top_k": 5
}
```

## 代码划分

### `frontend/`

前端静态文件。

- `index.html`
- `styles.css`
- `app.js`

这里主要放：
- 页面结构
- 样式
- 前端交互
- 录音、唤醒、播放的浏览器逻辑

### `services/webchat/`

主集成层。

- `server.py`

这里主要负责：
- 网页入口
- 静态资源加载
- `/api/chat`
- `/api/transcribe`
- `/api/tts`
- `/api/wake-check`
- 前后端总集成

### `services/wake/`

唤醒词服务。

- `sherpa_kws_server.py`
- `wake_keywords.txt`

这里主要负责：
- 专用 KWS
- 关键词配置
- 唤醒检测服务

### `services/asr/`

ASR 相关入口和说明。

当前仓库里主要通过：
- `services/webchat/server.py`
- `deploy/systemd/fw-whisper.service`

这里对应：
- 音频转写
- ASR 调用链路
- 短句识别稳定性

### `services/tts/`

TTS 服务。

- `cosyvoice_server.py`

这里主要负责：
- 本地 CosyVoice
- 本地 TTS 输出
- TTS 服务接口

### `services/agent/`

Agent / LLM 相关入口。

当前主要通过：
- `deploy/config/openclaw.json.example`
- `services/webchat/server.py` 里的 `run_openclaw()`

这里对应：
- OpenClaw
- prompt
- tool routing
- 多 agent

## 声纹身份确认与并行唤醒检测

`/api/wake-check` 会对同一个唤醒音频 chunk 并行执行两件事：

- 原有唤醒词检测：保留 ASR / sherpa-kws 逻辑，不替换 faster-whisper 或 KWS。
- 声纹验证：使用 ModelScope CAM++ 说话人确认模型。

最终只有 `wake_matched=true` 且 `speaker_matched=true` 时，才返回 `matched=true` 并触发正式录音。

安装依赖：

```bash
pip install "modelscope[audio]"
pip install torchaudio
```

如果 `modelscope[audio]` 安装失败，请根据服务器 Python、PyTorch、CUDA 环境分别安装 `modelscope`、`funasr`、`torchaudio` 等依赖。

开启声纹验证：

```bash
export OPENCLAW_SPEAKER_VERIFY_ENABLED=true
export OPENCLAW_SPEAKER_THRESHOLD=0.31
export OPENCLAW_SPEAKER_ID=owner
export OPENCLAW_SPEAKER_MODEL_ID=damo/speech_campplus_sv_zh-cn_16k-common
```

支持的声纹配置：

```bash
OPENCLAW_SPEAKER_VERIFY_ENABLED=false
OPENCLAW_SPEAKER_ID=owner
OPENCLAW_SPEAKER_THRESHOLD=0.31
OPENCLAW_SPEAKER_PROFILE_DIR=$HOME/.openclaw/webchat/speakers
OPENCLAW_SPEAKER_MODEL_ID=damo/speech_campplus_sv_zh-cn_16k-common
OPENCLAW_SPEAKER_SAMPLE_STRATEGY=best
```

如果默认模型加载失败，代码会尝试 fallback 到：

```text
iic/speech_campplus_sv_zh-cn_16k-common
```

阈值越高越严格。CAM++ 默认阈值为 `0.31`，需要根据实际唤醒音频分数调参；如果本人经常低于阈值，可以适当降低 `OPENCLAW_SPEAKER_THRESHOLD`。

启动 webchat 后，先注册声纹。注册后说唤醒词，系统会并行执行唤醒词检测和声纹验证；两者都通过才触发正式录音。如果不设置 `OPENCLAW_SPEAKER_VERIFY_ENABLED=true`，系统保持原行为。

### `deploy/`

## 声纹身份确认

本项目支持“固定唤醒词 + 声纹身份确认”。默认不开启；不开启时，原有唤醒词逻辑保持不变。

安装依赖：

```bash
pip install "modelscope[audio]" torchaudio
```

开启声纹验证：

```bash
export OPENCLAW_SPEAKER_VERIFY_ENABLED=true
export OPENCLAW_SPEAKER_THRESHOLD=0.31
export OPENCLAW_SPEAKER_ID=owner
```

可选配置：

```bash
export OPENCLAW_SPEAKER_PROFILE_DIR=$HOME/.openclaw/webchat/speakers
export OPENCLAW_SPEAKER_MODEL_ID=damo/speech_campplus_sv_zh-cn_16k-common
```

启动 webchat 后，先在网页点击“注册声纹”，录入当前身份的语音样本。注册后再说唤醒词，系统会同时检查唤醒词和声纹；只有两者都通过，才会进入正式录音。

如果不设置 `OPENCLAW_SPEAKER_VERIFY_ENABLED=true`，系统保持原行为。

### 多身份声纹模式

声纹样本按身份 ID 分目录保存：

```text
$HOME/.openclaw/webchat/speakers/<speaker_id>/enroll_*.wav
```

前端的“当前身份”只用于查看状态和注册新样本。唤醒检测时后端会遍历所有已经注册样本的身份，分别做 CAM++ speaker verification，取最高分对应的身份作为 `speaker_id`。最终仍然要求 `wake_matched=true` 且 `speaker_matched=true` 才会触发正式录音。

前端提供“唤醒范围”选项：

- `所有身份可唤醒`：遍历所有已注册身份，任意身份通过即可唤醒。
- `仅当前身份可唤醒`：只验证前端当前选择的身份，其他已注册身份说出唤醒词也不会触发正式录音。

声纹样本策略可通过 `OPENCLAW_SPEAKER_SAMPLE_STRATEGY` 调整：

- `best`：默认策略，逐条比对当前身份的所有注册样本并取最高分。
- `latest`：低延迟策略，只和每个身份最新的一段注册样本比对。配合“仅当前身份可唤醒”时，每次声纹验证只做一次 CAM++ 对比。

例如注册两个人：

1. 在前端身份输入框填 `owner`，点击“切换身份”，再注册声纹。
2. 在前端身份输入框填 `guest`，点击“切换身份”，再注册声纹。
3. 唤醒时系统会同时在 `owner`、`guest` 等已注册身份中寻找最高分匹配者。

`OPENCLAW_SPEAKER_ID` 仍然保留，作为默认身份 ID；它不再限制唤醒只能验证这一个身份。

### `deploy/`

部署模板。

- `systemd/`
- `config/openclaw.json.example`

这里主要放：
- systemd service 模板
- 配置模板
- 部署相关文件
