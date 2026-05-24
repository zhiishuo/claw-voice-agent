export const PIPELINE_ORDER = ["record", "upload", "transcribe", "transcript", "claw", "tts"];

export const PIPELINE_LABELS = {
  record: "1. 录音",
  upload: "2. 上传到服务器",
  transcribe: "3. 服务器转写",
  transcript: "4. 得到文本",
  claw: "5. 送进语音智能体",
  tts: "6. 回复语音",
};
