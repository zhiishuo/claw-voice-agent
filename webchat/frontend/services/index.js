import { createAuthService } from "./auth-service.js";
import { createChatService } from "./chat-service.js";
import { createDebugService } from "./debug-service.js";
import { createHttpClient } from "./http-client.js";
import { createKnowledgeService } from "./knowledge-service.js";
import { createSessionService } from "./session-service.js";
import { createSpeakerService } from "./speaker-service.js";
import { createTranscriptionService } from "./transcription-service.js";
import { createTtsService } from "./tts-service.js";
import { createWakeService } from "./wake-service.js";

export function createServices(context) {
  const http = createHttpClient({ getToken: () => context.token });
  const common = {
    getClientId: () => context.clientId,
    getSession: () => context.session,
    getLanguage: () => context.settings.transcriptLanguage,
  };

  return {
    http,
    auth: createAuthService(http),
    chat: createChatService(http, common),
    debug: createDebugService(http),
    knowledge: createKnowledgeService(http),
    sessions: createSessionService(http),
    speaker: createSpeakerService(http, common),
    transcription: createTranscriptionService(http, common),
    tts: createTtsService(http, common),
    wake: createWakeService(http, common),
  };
}
