import { CONFIG } from './config.js';
import { getAudioFilenameForMimeType } from './helpers.js';
import type { RoomAppAnalysisContext } from './types.js';
import { readStoredLocale, translateUiText } from '../../shared/locale';

function tr(text: string): string {
  return translateUiText(text, readStoredLocale());
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

const captureCanvasByApp = new WeakMap<RoomAppAnalysisContext, HTMLCanvasElement>();

function getCaptureCanvas(app: RoomAppAnalysisContext): HTMLCanvasElement {
  const existingCanvas = captureCanvasByApp.get(app);
  if (existingCanvas) {
    return existingCanvas;
  }

  const canvas = document.createElement('canvas');
  captureCanvasByApp.set(app, canvas);
  return canvas;
}

export async function toggleAnalysis(app: RoomAppAnalysisContext): Promise<void> {
  if (app.isAnalysisProcessing) {
    app.showError(tr('Analysis is still processing. Please wait.'));
    return;
  }

  if (app.isAnalysisEnabled) {
    app.endAnalysisAndCall();
    return;
  }

  const didStart = await app.startAnalysis();
  if (!didStart) {
    app.isAnalysisEnabled = false;
    app.setAnalysisToggleState('Start video call');
    return;
  }

  app.isAnalysisEnabled = true;
  app.setAnalysisToggleState('Stop video call');
}

export function endAnalysisAndCall(app: RoomAppAnalysisContext): void {
  const confirmed = window.confirm(
    tr('Stop analysis and end call?\n\nThis will end the call now and process your analysis.')
  );
  if (!confirmed) {
    return;
  }

  app.pendingNavigationToAnalysis = true;
  app.stopAnalysis();
  app.disconnectVideoCall();

  if (!app.isAnalysisProcessing) {
    app.pendingNavigationToAnalysis = false;
    app.navigateToAnalysis();
  }
}

export async function startAnalysis(app: RoomAppAnalysisContext): Promise<boolean> {
  if (app.isDisconnected) {
    app.showError(tr('Call has ended. Rejoin a room to run analysis.'));
    return false;
  }

  app.analysisStartTime = null;
  app.totalAnalysisDuration = 0;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    app.startAudioRecording(stream);
    app.startFrameCapture();
    return true;
  } catch (error) {
    console.error('Error accessing audio devices:', error);
    app.showError(tr('Failed to access microphone for analysis'));
    return false;
  }
}

export function stopAnalysis(app: RoomAppAnalysisContext): void {
  if (!app.isAnalysisEnabled && !app.analysisStartTime) {
    return;
  }

  const endTime = new Date().getTime();
  if (app.analysisStartTime) {
    const analysisDuration = (endTime - app.analysisStartTime) / 1000;
    app.totalAnalysisDuration += analysisDuration;
  }

  app.isAnalysisEnabled = false;
  app.setAnalysisToggleState('Start video call');
  app.isAnalysisProcessing = app.stopAudioRecording();
  app.analysisStartTime = null;
  app.captureLoopToken += 1;
  app.captureLoopActive = false;
  app.captureLoopPromise = null;
}

export function startAudioRecording(app: RoomAppAnalysisContext, stream: MediaStream): void {
  app.audioChunks = [];
  app.analysisAudioStream = stream;
  const recorder = new MediaRecorder(stream);
  app.mediaRecorder = recorder;
  app.analysisRecorderMimeType = recorder.mimeType || 'audio/webm';
  app.analysisRecorderFilename = getAudioFilenameForMimeType(app.analysisRecorderMimeType);

  recorder.ondataavailable = event => {
    app.audioChunks.push(event.data);
  };

  recorder.onstop = async () => {
    const chunks = [...app.audioChunks];
    app.audioChunks = [];
    const blobType = app.analysisRecorderMimeType || recorder.mimeType || 'audio/webm';
    const audioBlob = new Blob(chunks, { type: blobType });
    await app.sendAudioToAPI(audioBlob, app.analysisRecorderFilename);
  };

  app.analysisStartTime = new Date().getTime();
  recorder.start();
}

export function stopAudioRecording(app: RoomAppAnalysisContext): boolean {
  let recordingStopped = false;

  if (app.mediaRecorder && app.mediaRecorder.state !== 'inactive') {
    app.mediaRecorder.stop();
    recordingStopped = true;
  }

  if (app.analysisAudioStream) {
    app.analysisAudioStream.getTracks().forEach(track => track.stop());
    app.analysisAudioStream = null;
  }

  return recordingStopped;
}

export async function sendAudioToAPI(
  app: RoomAppAnalysisContext,
  audioBlob: Blob,
  audioFilename: string | null = null
): Promise<void> {
  try {
    app.isAnalysisProcessing = true;
    app.showProcessingIndicator(true);
    app.setAnalysisToggleState('Processing...', true);
    app.setMuteButtonState(undefined, true);

    const formData = new FormData();
    formData.append('audio', audioBlob, audioFilename || app.analysisRecorderFilename || 'audio.webm');
    formData.append('duration', String(app.totalAnalysisDuration));
    formData.append('client_id', app.myPeerId || 'local-user');

    const response = await fetch(`${CONFIG.API_BASE_URL}/upload-audio`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    app.appendResponseData(result);
    console.log('API Response:', result);

    app.isAnalysisProcessing = false;
    app.analysisRecorderMimeType = '';
    app.analysisRecorderFilename = '';
    app.setAnalysisToggleState('Start video call', app.isDisconnected);
    app.setMuteButtonState(undefined, app.isDisconnected);

    if (app.pendingNavigationToAnalysis) {
      app.pendingNavigationToAnalysis = false;
      app.navigateToAnalysis();
      return;
    }

    app.showProcessingSuccess();
  } catch (error) {
    console.error('Error sending audio to API:', getErrorMessage(error));
    app.isAnalysisProcessing = false;
    app.analysisRecorderMimeType = '';
    app.analysisRecorderFilename = '';
    app.setAnalysisToggleState('Start video call', app.isDisconnected);
    app.setMuteButtonState(undefined, app.isDisconnected);

    if (app.pendingNavigationToAnalysis) {
      app.pendingNavigationToAnalysis = false;
    }

    app.showProcessingError();
  }
}

export async function captureAndSendFrame(app: RoomAppAnalysisContext): Promise<void> {
  if (!app.isAnalysisEnabled || !app.myVideo.srcObject) {
    return;
  }

  try {
    const canvas = getCaptureCanvas(app);
    canvas.width = app.myVideo.videoWidth;
    canvas.height = app.myVideo.videoHeight;

    if (canvas.width === 0 || canvas.height === 0) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(app.myVideo, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToJpegBlob(canvas);
    if (!blob) {
      return;
    }

    const currentTime = new Date().getTime();
    const elapsedTime = app.analysisStartTime ? (currentTime - app.analysisStartTime) / 1000 : 0;

    await app.sendFrameToAPI(blob, elapsedTime);
  } catch (error) {
    console.error('Error capturing frame:', error);
  }
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
  });
}

export async function sendFrameToAPI(
  app: RoomAppAnalysisContext,
  blob: Blob | null,
  timestamp: number
): Promise<void> {
  if (!blob || app.myVideo.readyState !== 4 || app.myVideo.currentTime <= 0) {
    return;
  }

  try {
    const formData = new FormData();
    formData.append('image', blob, 'image.jpg');
    formData.append('timestamp', String(timestamp));
    formData.append('client_id', app.myPeerId || 'local-user');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(CONFIG.API_BASE_URL, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const result = await response.json();
      app.appendResponseData(result);
      console.log('API Response:', result);
    } catch (error) {
      if (isAbortError(error)) {
        console.warn('API request timed out after 5 seconds');
      } else {
        console.error('Error sending frame to API:', error);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error('Error preparing frame data:', error);
  }
}
