# WISE ATC 语音工作台 — 前端架构

## 目录结构

```
webchat/frontend/
├── index.html                          # 主页面（单页应用）
│
├── app/                                # 入口与全局状态
│   ├── main.js                         # 入口：初始化所有控制器、绑定事件
│   └── app-context.js                  # 全局共享状态（session、token、settings）
│
├── core/                               # 基础工具层
│   ├── config.js                       # 默认配置常量
│   ├── dom.js                          # DOM 查询快捷函数 ($, qsa)
│   ├── ids.js                          # ID 生成（client、session、request）
│   ├── storage.js                      # localStorage/sessionStorage 读写封装
│   └── store.js                        # 简单状态管理
│
├── features/                           # 功能模块（按职责划分）
│   ├── auth/
│   │   └── auth-token-card.js          # Token 输入与认证卡片
│   ├── chat/
│   │   ├── real-chat-flow.js           # 聊天流程（发送消息、渲染AI回复、引用、推荐对话）
│   │   ├── citation-tabs.js            # 知识库引用 tab 切换逻辑
│   │   └── audio-playback-controller.js # 音频播放控制（TTS、语音消息）
│   ├── composer/
│   │   └── composer-controller.js      # 输入框：发送、音频附件、推荐对话点击
│   ├── knowledge/
│   │   ├── knowledge-lab-controller.js # 知识库测试页（检索、可视化）
│   │   └── knowledge-toggle-controller.js # 知识库开关控制
│   ├── navigation/
│   │   └── navigation-controller.js    # 视图切换（主聊天 ↔ 知识库测试）
│   ├── sessions/
│   │   ├── session-list-controller.js  # 会话列表：新建/切换/删除、渲染欢迎页和历史消息
│   │   └── session-context-menu.js     # 会话右键菜单
│   ├── settings/
│   │   └── settings-controller.js      # 设置面板：读写设置、调试终端、留痕回看
│   ├── shell/
│   │   └── sidebar-controller.js       # 侧边栏折叠/展开
│   ├── voice/
│   │   ├── recorder-controller.js      # 浏览器录音（MediaRecorder + 转写确认）
│   │   ├── audio-import-controller.js  # 音频文件导入转写
│   │   ├── transcript-review.js        # 转写结果确认弹窗（录音和导入共用）
│   │   ├── mic-dropdown-controller.js  # 麦克风设备选择下拉
│   │   └── voice-mode-controller.js    # PTT/连续语音模式切换
│   ├── voiceprint/
│   │   └── voiceprint-controller.js    # 声纹注册弹窗（3段录音采集）
│   └── wake/
│       ├── wake-listener-controller.js # 唤醒词监听（PCM采集→WAV→后端检测）
│       ├── wake-utils.js               # 唤醒词文本处理（归一化、语言判断）
│       └── audio-codec.js              # Float32 PCM → 16-bit WAV 编码
│
├── services/                           # API 客户端层
│   ├── index.js                        # 服务工厂：创建所有 service 实例
│   ├── http-client.js                  # 统一 fetch 封装（自动带 token、错误处理）
│   ├── auth-service.js                 # GET /api/auth/check
│   ├── chat-service.js                 # POST /api/chat, POST /api/chat/suggestions
│   ├── session-service.js              # GET/DELETE /api/sessions, GET /api/messages
│   ├── transcription-service.js        # POST /api/transcribe
│   ├── tts-service.js                  # POST /api/tts
│   ├── knowledge-service.js            # GET /api/knowledge/status, POST /api/knowledge/search, GET /api/knowledge/visualization
│   ├── speaker-service.js              # GET /api/speaker/status, POST /api/speaker/enroll, POST /api/speaker/verify
│   ├── wake-service.js                 # POST /api/wake-check
│   └── debug-service.js               # GET /api/debug/last
│
├── styles/
│   └── main.css                        # 自定义样式（动画、滚动条、录音遮罩等）
│
├── vendor/                             # 第三方库（本地，无 CDN 依赖）
│   ├── tailwind/tailwind.js            # Tailwind CSS（JIT 运行时）
│   └── fontawesome/                    # FontAwesome 6.4.0
│       ├── css/all.min.css
│       └── webfonts/
│
└── resource/
    └── logoA1.png                      # 侧边栏 Logo
```

## 数据流

```
用户操作 → features/* 控制器 → services/* API 调用 → 后端
                                  ↓
                            app-context.js 更新状态
                                  ↓
                            UI 重新渲染
```

## 关键链路

| 链路     | 入口                              | 经过                                    |
| -------- | --------------------------------- | --------------------------------------- |
| 文本聊天 | composer → chatFlow.sendMessage  | chat-service → real-chat-flow 渲染     |
| 语音输入 | recorder → transcription-service | transcript-review 确认 → composer 发送 |
| 唤醒词   | wake-listener → wake-service     | 匹配后自动录音 → 转写 → 发送          |
| TTS 播放 | chatFlow → tts-service           | audio-playback-controller 播放          |
| 声纹注册 | voiceprint → speaker-service     | 3段录音 → enroll API                   |
