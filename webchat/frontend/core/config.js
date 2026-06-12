export const DEFAULT_CONFIG = {
  transcriptLanguage: "zh",
  autoSend: false,
  autoTts: true,
  ttsMode: "microsoft",
  ttsVoice: "zh-CN-XiaoxiaoNeural",
  knowledgeEnabled: true,
  wakePhrase: "你好",
  voiceInputMode: "ptt",
  autoPrependWake: true,
  streamingMode: true,
  wakeDetection: true,
  llmModel: "30b",
  llmGeneration: {
    "7b": { temperature: 0.2, maxTokens: 512 },
    "30b": { temperature: 0.3, maxTokens: 2048 },
  },
};
