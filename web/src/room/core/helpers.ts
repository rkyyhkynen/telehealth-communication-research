export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getSupportedPatientTurnMimeType(mimeTypes: readonly string[]): string {
  return mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

export function getAudioFilenameForMimeType(mimeType: string): string {
  const normalizedType = (mimeType || '').toLowerCase();
  if (normalizedType.includes('webm')) {
    return 'audio.webm';
  }
  if (normalizedType.includes('mp4') || normalizedType.includes('aac')) {
    return 'audio.mp4';
  }
  if (normalizedType.includes('ogg')) {
    return 'audio.ogg';
  }
  if (normalizedType.includes('mpeg') || normalizedType.includes('mp3')) {
    return 'audio.mp3';
  }
  if (normalizedType.includes('wav')) {
    return 'audio.wav';
  }
  return 'audio.webm';
}

export type WordTimings = {
  words: string[];
  wtimes: number[];
  wdurations: number[];
};

export function buildApproxWordTimings(text: string, durationSeconds: number): WordTimings {
  const words = (text || '')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean);

  if (!words.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { words: [], wtimes: [], wdurations: [] };
  }

  const totalMs = Math.max(300, Math.round(durationSeconds * 1000));
  const perWord = Math.max(1, Math.floor(totalMs / words.length));
  const durations = new Array(words.length).fill(perWord);
  durations[durations.length - 1] += totalMs - (perWord * words.length);

  const wtimes: number[] = [];
  let offset = 0;
  for (const d of durations) {
    wtimes.push(offset);
    offset += d;
  }

  return {
    words,
    wtimes,
    wdurations: durations
  };
}
