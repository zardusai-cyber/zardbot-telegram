# ZardBot Telegram

[![npm version](https://img.shields.io/npm/v/zardbot-telegram)](https://www.npmjs.com/package/zardbot-telegram)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

ZardBot Telegram is a Telegram client for [OpenCode](https://opencode.ai) with **Text-to-Speech (TTS)** and **Speech-to-Text (STT)** support.

Run AI coding tasks, monitor progress, switch models, and manage sessions from your phone -- with voice input and voice responses!

**Voice Features:**
- 🎤 **Speech-to-Text (STT)** -- Send voice messages, transcribe via whisper.cpp
- 🔊 **Text-to-Speech (TTS)** -- Agent responses read aloud with celebrity voices

**Credits:** Forked from [opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot) by Ruslan Grinev, enhanced with TTS/STT support.

---

## Features

All features from the original OpenCode Telegram Bot, plus:

- **Voice input (STT)** -- Send voice/audio messages, transcribe them via Whisper-compatible API
- **Voice output (TTS)** -- Agent responses spoken aloud with 82+ celebrity voices
- **Voice selection** -- `/voice` command to choose from available voices
- **Local TTS** -- Works with [pocket-tts-server](https://github.com/ai-joe-git/pocket-tts-server) for zero-cloud voice

### Core Features (from original)

- **Remote coding** -- send prompts to OpenCode from anywhere, receive results with code files
- **Session management** -- create new sessions or continue existing ones
- **Live status** -- pinned message with project, model, context usage, subagent activity
- **Model switching** -- pick models from favorites and recent history
- **Agent modes** -- switch between Plan and Build modes
- **Subagent activity** -- watch live subagent progress in chat
- **Custom Commands** -- run OpenCode custom commands from inline menu
- **Interactive Q&A** -- answer agent questions and approve permissions via buttons
- **File attachments** -- send images, PDFs, and text-based files to OpenCode
- **Scheduled tasks** -- schedule prompts to run later or on recurring intervals
- **Context control** -- compact context when it gets too large
- **Security** -- strict user ID whitelist
- **Localization** -- UI in English, Deutsch, Espanol, Francais, Russkii, Zhongwen

---

## Prerequisites

- **Node.js 20+** -- [download](https://nodejs.org)
- **OpenCode** -- install from [opencode.ai](https://opencode.ai) or [GitHub](https://github.com/sst/opencode)
- **Telegram Bot** -- create one via [@BotFather](https://t.me/BotFather)

### Optional (for voice features)

- **pocket-tts-server** -- Local TTS with 82+ celebrity voices: [GitHub](https://github.com/ai-joe-git/pocket-tts-server)
- **whisper.cpp** -- Local STT: [GitHub](https://github.com/ggerganov/whisper.cpp)

---

## Quick Start

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) and send `/newbot`
2. Follow prompts to choose name and username
3. Copy the **bot token**

Get your **Telegram User ID** from [@userinfobot](https://t.me/userinfobot).

### 2. Start OpenCode Server

```bash
opencode serve
```

The bot connects to `http://localhost:4096` by default.

### 3. Install & Run

```bash
npx zardbot-telegram
```

An interactive wizard will guide you through configuration.

#### Alternative: Global Install

```bash
npm install -g zardbot-telegram
zardbot-telegram start
```

To reconfigure at any time:

```bash
zardbot-telegram config
```

The setup wizard will guide you through configuration.

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/status` | Server health, project, session, model info |
| `/new` | Create a new session |
| `/abort` | Abort current task |
| `/sessions` | Browse and switch sessions |
| `/projects` | Switch between projects |
| `/rename` | Rename current session |
| `/voice` | Select TTS voice (when TTS configured) |
| `/commands` | Run custom commands |
| `/task` | Create scheduled task |
| `/tasklist` | Manage scheduled tasks |
| `/opencode_start` | Start OpenCode server remotely |
| `/opencode_stop` | Stop OpenCode server remotely |
| `/help` | Show available commands |

---

## Configuration

Config stored in `.env`:

- **macOS:** `~/Library/Application Support/zardbot-telegram/.env`
- **Windows:** `%APPDATA%\zardbot-telegram\.env`
- **Linux:** `~/.config/zardbot-telegram/.env`

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|:--------:|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Yes | -- |
| `TELEGRAM_ALLOWED_USER_ID` | Your Telegram user ID | Yes | -- |
| `TELEGRAM_PROXY_URL` | Proxy for Telegram API | No | -- |
| `OPENCODE_API_URL` | OpenCode server URL | No | `http://localhost:4096` |
| `OPENCODE_SERVER_USERNAME` | Server auth username | No | `opencode` |
| `OPENCODE_SERVER_PASSWORD` | Server auth password | No | -- |
| `OPENCODE_MODEL_PROVIDER` | Default model provider | Yes | `opencode` |
| `OPENCODE_MODEL_ID` | Default model ID | Yes | `big-pickle` |
| `BOT_LOCALE` | UI language (`en`, `de`, `es`, `fr`, `ru`, `zh`) | No | `en` |
| `LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) | No | `info` |

### Speech-to-Text (STT)

| Variable | Description | Required | Default |
|----------|-------------|:--------:|---------|
| `STT_API_URL` | Whisper-compatible API URL | No | -- |
| `STT_API_KEY` | API key for STT provider | No | -- |
| `STT_MODEL` | STT model name | No | `whisper-large-v3-turbo` |
| `STT_LANGUAGE` | Language hint | No | -- |

#### STT Providers

**Local whisper.cpp:**
```env
STT_API_URL=http://localhost:8080
STT_API_KEY=
```

**OpenAI:**
```env
STT_API_URL=https://api.openai.com/v1
STT_API_KEY=sk-your-api-key
STT_MODEL=whisper-1
```

**Groq:**
```env
STT_API_URL=https://api.groq.com/openai/v1
STT_API_KEY=gsk-your-api-key
STT_MODEL=whisper-large-v3-turbo
```

### Text-to-Speech (TTS)

| Variable | Description | Required | Default |
|----------|-------------|:--------:|---------|
| `TTS_API_URL` | TTS server URL | No | -- |
| `TTS_DEFAULT_VOICE` | Default voice ID | No | `david-attenborough-original` |
| `TTS_MODEL` | TTS model name | No | `tts-1` |
| `TTS_SPEED` | Speech speed multiplier | No | `1.0` |

#### TTS Setup (pocket-tts-server)

```env
TTS_API_URL=http://localhost:8000
TTS_DEFAULT_VOICE=david-attenborough-original
```

Setup [pocket-tts-server](https://github.com/ai-joe-git/pocket-tts-server):
- 82+ celebrity voice clones
- Local processing (no cloud)
- No API costs

**Available Voices:**
- `david-attenborough-original`
- `morgan-freeman-original`
- `jarvis-iron-man`
- `margot-robie`
- `chris-evans`
- And many more...

Use `/voice` in the bot to select from available voices.

---

## Development

### Running from Source

```bash
git clone https://github.com/ai-joe-git/zardbot-telegram.git
cd zardbot-telegram
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Build and start |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled code |
| `npm run lint` | ESLint check |
| `npm run format` | Format with Prettier |
| `npm test` | Run tests |

---

## Security

Strict **user ID whitelist**. Only `TELEGRAM_ALLOWED_USER_ID` can interact with the bot.

---

## License

[MIT](LICENSE)

---

## Acknowledgments

- **Ruslan Grinev** -- Original [opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)
- **OpenCode Team** -- [opencode.ai](https://opencode.ai)
