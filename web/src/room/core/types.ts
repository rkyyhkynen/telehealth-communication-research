import type { AnalysisApiEntry } from '../../shared/analysisApi';

export type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface PeerCallLike {
  peer: string;
  close: () => void;
  answer: (stream: MediaStream) => void;
  on: <T extends unknown[]>(event: string, handler: (...args: T) => void) => void;
}

export interface PeerLike {
  id?: string;
  destroyed?: boolean;
  on: <T extends unknown[]>(event: string, handler: (...args: T) => void) => void;
  call: (userId: string, stream: MediaStream) => PeerCallLike | null | undefined;
  removeAllListeners: () => void;
  destroy: () => void;
}

export interface SocketLike {
  emit: (event: string, ...args: unknown[]) => void;
  on: <T extends unknown[]>(event: string, handler: (...args: T) => void) => void;
  disconnect: () => void;
}

export interface RoomAppPeerContext {
  roomId: string;
  myPeer: PeerLike | null;
  myPeerId: string | null;
  socket: SocketLike;
  isDisconnected: boolean;
  connectedUsers: string[];
  peers: Record<string, PeerCallLike>;
  pendingConnectTimeouts: Set<TimeoutHandle>;
  myVideoStream: MediaStream | null;
  analysisAudioStream: MediaStream | null;
  myVideo: HTMLVideoElement;
  remoteAudioContexts: Map<string, AudioContext>;
  captureLoopToken: number;
  captureLoopActive: boolean;
  captureLoopPromise: Promise<void> | null;
  isPatientRecording: boolean;
  aiPatientHead: { stop?: () => void } | null;
  ensureLocalStreamReady: () => Promise<MediaStream | null>;
  handleCall: (call: PeerCallLike) => Promise<void> | void;
  handleUserConnected: (userId: string) => void;
  handleUserDisconnected: (userId: string) => void;
  showError: (message: string) => void;
  createVideoElement: () => HTMLVideoElement;
  addVideoStream: (video: HTMLVideoElement, stream: MediaStream, userId?: string) => void;
  processAudioStream: (stream: MediaStream, userId: string) => void;
  removeVideoStream: (userId: string) => void;
  connectToNewUser: (userId: string) => Promise<void> | void;
  stopPatientTurnRecording: () => void;
  cleanupPatientTurnRecorder: () => void;
  stopPatientSpeech: () => void;
  emitPatientTurnState: () => void;
  closeRemoteAudioContext: (userId: string) => void;
}

export interface RoomAppAnalysisContext {
  isAnalysisProcessing: boolean;
  showError: (message: string) => void;
  isAnalysisEnabled: boolean;
  endAnalysisAndCall: () => void;
  startAnalysis: () => Promise<boolean>;
  analysisToggle: HTMLButtonElement;
  pendingNavigationToAnalysis: boolean;
  stopAnalysis: () => void;
  disconnectVideoCall: () => void;
  isDisconnected: boolean;
  analysisStartTime: number | null;
  totalAnalysisDuration: number;
  startAudioRecording: (stream: MediaStream) => void;
  stopAudioRecording: () => boolean;
  startFrameCapture: () => void;
  captureLoopToken: number;
  captureLoopActive: boolean;
  captureLoopPromise: Promise<void> | null;
  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];
  analysisAudioStream: MediaStream | null;
  analysisRecorderMimeType: string;
  analysisRecorderFilename: string;
  sendAudioToAPI: (audioBlob: Blob, audioFilename?: string | null) => Promise<void>;
  setAnalysisToggleState: (label?: string, disabled?: boolean) => void;
  setMuteButtonState: (label?: string, disabled?: boolean) => void;
  showProcessingIndicator: (show: boolean) => void;
  muteButton: HTMLButtonElement;
  appendResponseData: (entry: AnalysisApiEntry) => void;
  myPeerId: string | null;
  showProcessingSuccess: () => void;
  showProcessingError: () => void;
  navigateToAnalysis: () => void;
  myVideo: HTMLVideoElement;
  sendFrameToAPI: (blob: Blob, timestamp: number) => Promise<void>;
}

export interface RoomAppPatientTurnContext {
  enableAIPatient: boolean;
  isPatientProcessing: boolean;
  isPatientRecording: boolean;
  isDisconnected: boolean;
  aiPatientHead: { audioCtx?: AudioContext | null } | null;
  primePatientSpeechPath: () => void;
  startPatientTurnRecording: () => Promise<void> | void;
  stopPatientTurnRecording: () => void;
  myVideoStream: MediaStream | null;
  getPatientTurnAudioStream: () => Promise<MediaStream>;
  patientTurnStream: MediaStream | null;
  patientTurnRecorder: MediaRecorder | null;
  stopMediaStream: (stream: MediaStream | null) => void;
  processPatientTurn: (audioBlob: Blob) => Promise<void>;
  emitPatientTurnState: () => void;
}
