import { API_BASE_URL } from '../../shared/apiBaseUrl';
const APP_SECURE = window.location.protocol === 'https:';
const APP_HOSTNAME = window.location.hostname || 'localhost';

export const CONFIG = {
  PEER: {
    host: APP_HOSTNAME,
    port: '3001',
    path: '/',
    secure: APP_SECURE
  },
  API_BASE_URL,
  FRAME_CAPTURE_INTERVAL: 750,
  RESPONSE_DATA_MAX_ENTRIES: 3000,
  PATIENT_TRANSCRIBE_ENDPOINT: '/upload-audio',
  PATIENT_CHAT_ENDPOINT: '/llm-patient-chat',
  PATIENT_TTS_ENDPOINT: '/piper-tts',
  PATIENT_MAX_CONVERSATION_ITEMS: 8,
  PATIENT_TURN_MIME_TYPES: [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4'
  ]
};
