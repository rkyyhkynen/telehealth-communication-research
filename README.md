# CallPython

Telehealth simulation app with:

- live room call (`/room/:room`)
- avatar patient mode (`/avatar/:room`)
- post-call analytics dashboard (`/analysis`)

## Stack

- Web: Express, React (Vite), Socket.IO, PeerJS
- API: FastAPI, MediaPipe, DeepFace, Whisper, Ollama, Piper TTS

## Quick start

### Prerequisites

- Node.js + npm
- Python environment (Conda recommended)
- FFmpeg
- Ollama running locally
- HTTPS certs:
  - `certs/cert.pem`
  - `certs/key.pem`
- Avatar
- Mediapipe landmark modules

## Key endpoints

- `POST /` frame analysis
- `POST /upload-audio` audio transcription + speech metrics
- `POST /llm-analysis` nonverbal summary
- `POST /llm-chat` follow-up Q&A
- `POST /llm-patient-chat` avatar patient reply
- `POST /piper-tts` avatar patient speech synthesis

## Project layout

- `server.ts` Node HTTPS app + routes + Socket.IO
- `api/server.py` FastAPI analysis backend
- `web/src/room/` room app and call runtime
- `web/src/analysis/` dashboard and charts
- `web/src/shared/` shared browser-side types

