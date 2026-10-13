const PATIENT_API_TIMEOUT_MS = 45000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = PATIENT_API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function transcribePatientAudioTurn(params: {
  audioBlob: Blob;
  apiBaseUrl: string;
  endpoint: string;
  clientId: string;
}): Promise<string> {
  const formData = new FormData();
  formData.append('audio', params.audioBlob, 'patient-turn.webm');
  formData.append('duration', '0');
  formData.append('client_id', params.clientId);

  const response = await fetchWithTimeout(`${params.apiBaseUrl}${params.endpoint}`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Transcription failed (${response.status})`);
  }

  const payload = await response.json();
  return (payload?.audioResult?.text || '').trim();
}

export async function fetchPatientChatReply(params: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  apiBaseUrl: string;
  endpoint: string;
}): Promise<string> {
  const response = await fetchWithTimeout(`${params.apiBaseUrl}${params.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation: params.conversation })
  });

  if (!response.ok) {
    throw new Error(`Patient chat failed (${response.status})`);
  }

  const payload = await response.json();
  const reply = (payload?.response || '').trim();
  if (!reply) {
    throw new Error('Patient response was empty.');
  }

  return reply;
}

export async function synthesizePatientSpeechBlob(params: {
  replyText: string;
  apiBaseUrl: string;
  endpoint: string;
}): Promise<Blob> {
  const response = await fetchWithTimeout(`${params.apiBaseUrl}${params.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: params.replyText })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Piper TTS failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  if (!payload?.audio_base64) {
    throw new Error('TTS response missing audio.');
  }

  const bytes = Uint8Array.from(atob(payload.audio_base64), char => char.charCodeAt(0));
  return new Blob([bytes], { type: payload.mime || 'audio/wav' });
}
