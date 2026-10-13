import { CONFIG } from './config.js';
import { getSupportedPatientTurnMimeType } from './helpers.js';
import type { RoomAppPatientTurnContext } from './types.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }
  return target.matches('input, textarea, select, [contenteditable="true"]');
}

export function handlePushToTalkKeyDown(app: RoomAppPatientTurnContext, event: KeyboardEvent): void {
  if (!app.enableAIPatient) {
    return;
  }
  if (event.code !== 'Space' || event.repeat) {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }

  event.preventDefault();

  if (app.isPatientProcessing || app.isPatientRecording || app.isDisconnected) {
    return;
  }

  if (app.aiPatientHead?.audioCtx && app.aiPatientHead.audioCtx.state !== 'running') {
    app.aiPatientHead.audioCtx.resume().catch(() => {});
  }

  app.startPatientTurnRecording();
}

export function handlePushToTalkKeyUp(app: RoomAppPatientTurnContext, event: KeyboardEvent): void {
  if (!app.enableAIPatient) {
    return;
  }
  if (event.code !== 'Space') {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }

  event.preventDefault();

  if (app.isPatientRecording) {
    app.stopPatientTurnRecording();
  }
}

export async function getPatientTurnAudioStream(app: RoomAppPatientTurnContext): Promise<MediaStream> {
  if (app.myVideoStream) {
    const audioTracks = app.myVideoStream.getAudioTracks();
    if (audioTracks.length > 0) {
      return new MediaStream([audioTracks[0].clone()]);
    }
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
}

export async function startPatientTurnRecording(app: RoomAppPatientTurnContext): Promise<void> {
  if (!app.enableAIPatient || app.isPatientProcessing || app.isPatientRecording || app.isDisconnected) {
    return;
  }

  if (app.aiPatientHead?.audioCtx) {
    if (app.aiPatientHead.audioCtx.state === 'running') {
      app.primePatientSpeechPath();
    } else {
      app.aiPatientHead.audioCtx.resume()
        .then(() => {
          app.primePatientSpeechPath();
        })
        .catch(() => {});
    }
  }

  let recorderStream: MediaStream | null = null;
  try {
    const mimeType = getSupportedPatientTurnMimeType(CONFIG.PATIENT_TURN_MIME_TYPES);
    recorderStream = await app.getPatientTurnAudioStream();
    const chunks: Blob[] = [];

    const recorderOptions = mimeType ? { mimeType } : undefined;
    const recorder = new MediaRecorder(recorderStream, recorderOptions);

    app.patientTurnStream = recorderStream;
    app.patientTurnRecorder = recorder;

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = (event: Event) => {
      const eventWithError = event as Event & { error?: unknown };
      console.error('Patient turn recording failed:', eventWithError.error);
      if (app.patientTurnRecorder === recorder) {
        app.patientTurnRecorder = null;
        app.patientTurnStream = null;
        app.isPatientRecording = false;
      }
      app.stopMediaStream(recorderStream);
      app.emitPatientTurnState();
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      if (app.patientTurnRecorder === recorder) {
        app.patientTurnRecorder = null;
        app.patientTurnStream = null;
      }
      app.stopMediaStream(recorderStream);

      try {
        await app.processPatientTurn(blob);
      } finally {
        app.isPatientRecording = false;
        app.emitPatientTurnState();
      }
    };

    recorder.start();
    app.isPatientRecording = true;
    app.emitPatientTurnState();
  } catch (error) {
    console.error('Could not start patient turn recording:', getErrorMessage(error));
    app.stopMediaStream(recorderStream);
    if (app.patientTurnStream === recorderStream) {
      app.patientTurnStream = null;
    }
    app.patientTurnRecorder = null;
    app.isPatientRecording = false;
    app.emitPatientTurnState();
  }
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => {
    if (track.readyState === 'live') {
      track.stop();
    }
  });
}

export function stopPatientTurnRecording(app: RoomAppPatientTurnContext): void {
  if (!app.patientTurnRecorder || app.patientTurnRecorder.state === 'inactive') {
    return;
  }
  app.patientTurnRecorder.stop();
  app.isPatientRecording = false;
  app.emitPatientTurnState();
}

export function cleanupPatientTurnRecorder(app: RoomAppPatientTurnContext): void {
  app.stopMediaStream(app.patientTurnStream);
  app.patientTurnStream = null;
  app.patientTurnRecorder = null;
  app.isPatientRecording = false;
  app.emitPatientTurnState();
}
