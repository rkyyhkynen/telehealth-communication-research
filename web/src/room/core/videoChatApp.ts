import { CONFIG } from './config.js';
import {
  buildApproxWordTimings,
  sleep
} from './helpers.js';
import {
  fetchPatientChatReply,
  synthesizePatientSpeechBlob,
  transcribePatientAudioTurn
} from './patientApi.js';
import {
  connectToNewUser as connectToNewUserFeature,
  disconnectVideoCall as disconnectVideoCallFeature,
  handleCall as handleCallFeature,
  handleUserConnected as handleUserConnectedFeature,
  handleUserDisconnected as handleUserDisconnectedFeature,
  initializePeerConnection as initializePeerConnectionFeature,
  processAudioStream as processAudioStreamFeature
} from './peerSession.js';
import {
  canvasToJpegBlob as canvasToJpegBlobFeature,
  captureAndSendFrame as captureAndSendFrameFeature,
  endAnalysisAndCall as endAnalysisAndCallFeature,
  sendAudioToAPI as sendAudioToAPIFeature,
  sendFrameToAPI as sendFrameToAPIFeature,
  startAnalysis as startAnalysisFeature,
  startAudioRecording as startAudioRecordingFeature,
  stopAnalysis as stopAnalysisFeature,
  stopAudioRecording as stopAudioRecordingFeature,
  toggleAnalysis as toggleAnalysisFeature
} from './analysisCapture.js';
import {
  cleanupPatientTurnRecorder as cleanupPatientTurnRecorderFeature,
  getPatientTurnAudioStream as getPatientTurnAudioStreamFeature,
  handlePushToTalkKeyDown as handlePushToTalkKeyDownFeature,
  handlePushToTalkKeyUp as handlePushToTalkKeyUpFeature,
  isEditableTarget as isEditableTargetFeature,
  startPatientTurnRecording as startPatientTurnRecordingFeature,
  stopMediaStream as stopMediaStreamFeature,
  stopPatientTurnRecording as stopPatientTurnRecordingFeature
} from './patientTurnRecording.js';
import type {
  PeerCallLike,
  PeerLike,
  SocketLike
} from './types.js';
import type { AnalysisApiEntry } from '../../shared/analysisApi';
import { queueLocaleForNextPage, type AppLocale } from '../../shared/locale';

type ConversationItem = {
  role: 'user' | 'assistant';
  content: string;
};

type AvatarSpeechPayload = {
  audio: AudioBuffer;
  words: string[];
  wtimes: number[];
  wdurations: number[];
};

interface AIPatientHead {
  audioCtx?: AudioContext;
  showAvatar?: (options: {
    url: string;
    body: string;
    lipsyncLang: string;
    avatarMood: string;
  }) => Promise<void>;
  speakAudio?: (payload: AvatarSpeechPayload, options: { lipsyncLang: string; isRaw?: boolean }) => void;
  stopSpeaking?: () => void;
  stop?: () => void;
}

type RoomControlsState = {
  muteLabel: string;
  muteDisabled: boolean;
  analysisLabel: string;
  analysisDisabled: boolean;
};

type RoomProcessingState = {
  visible: boolean;
  mode: 'processing' | 'success' | 'error';
  message: string;
};

type PatientTurnUiState = {
  message: string;
  active: boolean;
  disabled: boolean;
};

type IoFactory = (namespace?: string) => SocketLike;
type PeerConstructor = new (id?: string, options?: unknown) => PeerLike;

type VideoChatAppDomElements = {
  videoGrid: HTMLElement;
  muteButton: HTMLButtonElement;
  analysisToggle: HTMLButtonElement;
};

type VideoChatAppOptions = {
  ioFactory?: IoFactory;
  peerConstructor?: PeerConstructor;
  elements?: VideoChatAppDomElements;
  aiPatientContainer?: HTMLElement | null;
  roomId: string;
  analysisPath: string;
  enableAIPatient?: boolean;
  patientAvatarConfig?: {
    moduleUrl: string;
    modelUrl: string;
  } | null;
  uiCallbacks?: {
    onError?: (message: string) => void;
    onControlsChange?: (state: RoomControlsState) => void;
    onProcessingChange?: (state: RoomProcessingState) => void;
    onPatientTurnStateChange?: (state: PatientTurnUiState) => void;
    onVideoTileUpsert?: (tile: { id: string; stream: MediaStream; muted: boolean }) => void;
    onVideoTileRemove?: (tileId: string) => void;
  };
};

type TalkingHeadConstructor = new (
  container: HTMLElement,
  options: {
    cameraView: string;
    lipsyncModules: string[];
    avatarMood: string;
  }
) => AIPatientHead;

// Main application class
export class VideoChatApp {
  socket: SocketLike;
  myPeer: PeerLike | null;
  roomId: string;
  domElements: VideoChatAppDomElements;
  videoGrid: HTMLElement;
  myVideo: HTMLVideoElement;
  muteButton!: HTMLButtonElement;
  analysisToggle!: HTMLButtonElement;
  muteLabelText: string;
  analysisLabelText: string;

  peers: Record<string, PeerCallLike>;
  remoteVideoElements: Map<string, HTMLVideoElement>;
  connectedUsers: string[];
  responseData: AnalysisApiEntry[];
  isAnalysisEnabled: boolean;
  myVideoStream: MediaStream | null;
  myPeerId: string | null;

  analysisStartTime: number | null;
  totalAnalysisDuration: number;
  isAnalysisProcessing: boolean;
  pendingNavigationToAnalysis: boolean;
  analysisAudioStream: MediaStream | null;
  analysisRecorderMimeType: string;
  analysisRecorderFilename: string;
  mediaRecorder: MediaRecorder | null;
  audioChunks: Blob[];

  remoteAudioContexts: Map<string, AudioContext>;
  captureLoopActive: boolean;
  captureLoopPromise: Promise<void> | null;
  captureLoopToken: number;
  pendingConnectTimeouts: Set<ReturnType<typeof setTimeout>>;
  isDisconnected: boolean;

  aiPatientHead: AIPatientHead | null;
  aiPatientSlot: HTMLElement | null;
  aiPatientContainer: HTMLElement | null;
  ownsAIPatientSlot: boolean;
  patientConversation: ConversationItem[];
  patientTurnRecorder: MediaRecorder | null;
  patientTurnStream: MediaStream | null;
  isPatientRecording: boolean;
  isPatientProcessing: boolean;
  isPatientSpeechPathPrimed: boolean;
  patientAudio: HTMLAudioElement;
  patientAudioUrl: string | null;
  enableAIPatient: boolean;
  analysisPath: string;
  patientAvatarConfig: {
    moduleUrl: string;
    modelUrl: string;
  } | null;
  uiCallbacks: NonNullable<VideoChatAppOptions['uiCallbacks']>;

  videoStreamReadyPromise: Promise<MediaStream | null> | null;
  onWindowKeyDown: ((event: KeyboardEvent) => void) | null;
  onWindowKeyUp: ((event: KeyboardEvent) => void) | null;
  onWindowBlur: (() => void) | null;

  constructor(options: VideoChatAppOptions) {
    const ioFactory = options.ioFactory;
    if (typeof ioFactory !== 'function') {
      throw new Error('Socket.IO client factory is not available.');
    }

    const peerConstructor = options.peerConstructor;
    if (typeof peerConstructor !== 'function') {
      throw new Error('PeerJS constructor is not available.');
    }

    this.socket = ioFactory('/');
    this.myPeer = new peerConstructor(undefined, CONFIG.PEER);
    this.roomId = options.roomId;
    if (!this.roomId.trim()) {
      throw new Error('Room ID is required.');
    }
    if (!options.elements) {
      throw new Error('Room DOM elements are required.');
    }
    this.domElements = options.elements;
    this.videoGrid = this.domElements.videoGrid;
    this.myVideo = this.createVideoElement();
    this.muteLabelText = 'Mute';
    this.analysisLabelText = 'Start video call';

    this.peers = {};
    this.remoteVideoElements = new Map();
    this.connectedUsers = [];
    this.responseData = [];
    this.isAnalysisEnabled = false;
    this.myVideoStream = null;
    this.myPeerId = null;

    this.analysisStartTime = null;
    this.totalAnalysisDuration = 0;
    this.isAnalysisProcessing = false;
    this.pendingNavigationToAnalysis = false;
    this.analysisAudioStream = null;
    this.analysisRecorderMimeType = '';
    this.analysisRecorderFilename = '';
    this.mediaRecorder = null;
    this.audioChunks = [];

    this.remoteAudioContexts = new Map();
    this.captureLoopActive = false;
    this.captureLoopPromise = null;
    this.captureLoopToken = 0;
    this.pendingConnectTimeouts = new Set();
    this.isDisconnected = false;

    this.aiPatientHead = null;
    this.aiPatientSlot = null;
    this.aiPatientContainer = options.aiPatientContainer || null;
    this.ownsAIPatientSlot = false;
    this.patientConversation = [];
    this.patientTurnRecorder = null;
    this.patientTurnStream = null;
    this.isPatientRecording = false;
    this.isPatientProcessing = false;
    this.isPatientSpeechPathPrimed = false;
    this.patientAudio = new Audio();
    this.patientAudio.preload = 'auto';
    this.patientAudioUrl = null;
    this.enableAIPatient = typeof options.enableAIPatient === 'boolean'
      ? options.enableAIPatient
      : false;
    this.analysisPath = options.analysisPath;
    this.patientAvatarConfig = options.patientAvatarConfig ?? null;
    this.uiCallbacks = options.uiCallbacks || {};

    this.videoStreamReadyPromise = null;
    this.onWindowKeyDown = null;
    this.onWindowKeyUp = null;
    this.onWindowBlur = null;
    this.setupDOMElements();
    this.emitPatientTurnState();
    this.init();
  }

  setupDOMElements(): void {
    this.muteButton = this.domElements.muteButton;
    this.analysisToggle = this.domElements.analysisToggle;
    this.setMuteButtonState('Mute');
    this.setAnalysisToggleState('Start video call');
  }

  init(): void {
    this.videoStreamReadyPromise = this.startVideoStream();
    this.setupEventListeners();
    this.initializePeerConnection();
  }

  startFrameCapture(): void {
    if (this.captureLoopActive) {
      return;
    }

    this.captureLoopActive = true;
    this.captureLoopToken += 1;
    const loopToken = this.captureLoopToken;
    this.captureLoopPromise = this.runFrameCaptureLoop(loopToken);
  }

  async runFrameCaptureLoop(loopToken: number): Promise<void> {
    while (this.captureLoopActive && loopToken === this.captureLoopToken) {
      const startedAt = Date.now();
      await this.captureAndSendFrame();
      const elapsedMs = Date.now() - startedAt;
      const waitMs = Math.max(0, CONFIG.FRAME_CAPTURE_INTERVAL - elapsedMs);
      await sleep(waitMs);
    }
  }

  appendResponseData(entry: AnalysisApiEntry): void {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    this.responseData.push(entry);
    const excess = this.responseData.length - CONFIG.RESPONSE_DATA_MAX_ENTRIES;
    if (excess > 0) {
      this.responseData.splice(0, excess);
    }
  }

  createVideoElement(): HTMLVideoElement {
    const video = document.createElement('video');
    video.muted = true;
    return video;
  }

  async startVideoStream(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.setupVideoStream(stream);
      return stream;
    } catch (error) {
      console.error('Failed to access media devices:', error);
      this.showError('Could not access your camera or microphone. Please check your device permissions.');
      return null;
    }
  }

  async ensureLocalStreamReady(): Promise<MediaStream | null> {
    if (this.myVideoStream) {
      return this.myVideoStream;
    }
    if (this.videoStreamReadyPromise) {
      await this.videoStreamReadyPromise;
    }
    return this.myVideoStream;
  }

  setupVideoStream(stream: MediaStream): void {
    this.myVideoStream = stream;
    this.addVideoStream(this.myVideo, stream);
    if (this.enableAIPatient) {
      void this.initializeAIPatientAvatar();
    }
  }

  addVideoStream(video: HTMLVideoElement, stream: MediaStream, userId?: string): void {
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
      void video.play();
    });

    if (userId) {
      const previousVideo = this.remoteVideoElements.get(userId);
      if (previousVideo && previousVideo !== video) {
        previousVideo.srcObject = null;
        previousVideo.remove();
      }
      video.id = userId;
      this.remoteVideoElements.set(userId, video);
    }

    if (this.myPeer && userId === this.myPeer.id) {
      video.muted = true;
    }

    if (this.uiCallbacks.onVideoTileUpsert) {
      const tileId = userId || 'local-preview';
      this.uiCallbacks.onVideoTileUpsert({
        id: tileId,
        stream,
        muted: video.muted
      });
      if (!userId && !video.isConnected) {
        video.style.display = 'none';
        video.setAttribute('aria-hidden', 'true');
        document.body.appendChild(video);
      }
      return;
    }

    this.videoGrid.appendChild(video);
  }

  ensureAIPatientSlot(): HTMLElement {
    if (this.aiPatientSlot) {
      return this.aiPatientSlot;
    }

    if (this.aiPatientContainer) {
      this.aiPatientSlot = this.aiPatientContainer;
      this.ownsAIPatientSlot = false;
      return this.aiPatientSlot;
    }

    const slot = document.createElement('div');
    slot.id = 'ai-patient-slot';
    slot.className = 'ai-patient-slot';
    this.videoGrid.appendChild(slot);
    this.aiPatientSlot = slot;
    this.ownsAIPatientSlot = true;
    return slot;
  }

  async initializeAIPatientAvatar(): Promise<void> {
    const slot = this.ensureAIPatientSlot();
    const config = this.patientAvatarConfig;

    if (!config || !config.moduleUrl || !config.modelUrl) {
      console.warn('AI avatar config missing module/model URL.');
      return;
    }

    try {
      const module = (await import(config.moduleUrl)) as {
        TalkingHead?: TalkingHeadConstructor;
        default?: TalkingHeadConstructor;
      };
      const TalkingHead = module.TalkingHead || module.default;

      if (!TalkingHead) {
        throw new Error('TalkingHead class not found.');
      }

      this.aiPatientHead = new TalkingHead(slot, {
        cameraView: 'upper',
        lipsyncModules: ['fi', 'en'],
        avatarMood: 'neutral'
      });

      if (typeof this.aiPatientHead.showAvatar === 'function') {
        await this.aiPatientHead.showAvatar({
          url: config.modelUrl,
          body: 'F',
          lipsyncLang: 'fi',
          avatarMood: 'neutral'
        });
      }
    } catch (error) {
      console.error('Failed to initialize AI patient avatar:', error);
    }
  }

  removeVideoStream(userId: string): void {
    if (this.uiCallbacks.onVideoTileRemove) {
      this.uiCallbacks.onVideoTileRemove(userId);
    }

    const trackedVideo = this.remoteVideoElements.get(userId);
    if (trackedVideo) {
      trackedVideo.srcObject = null;
      trackedVideo.remove();
      this.remoteVideoElements.delete(userId);
    }

    this.closeRemoteAudioContext(userId);
    delete this.peers[userId];

    const index = this.connectedUsers.indexOf(userId);
    if (index !== -1) {
      this.connectedUsers.splice(index, 1);
    }
  }

  closeRemoteAudioContext(userId: string): void {
    const audioContext = this.remoteAudioContexts.get(userId);
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
    this.remoteAudioContexts.delete(userId);
  }

  setupEventListeners(): void {
    if (this.enableAIPatient) {
      this.onWindowKeyDown = (event) => this.handlePushToTalkKeyDown(event);
      this.onWindowKeyUp = (event) => this.handlePushToTalkKeyUp(event);
      this.onWindowBlur = () => {
        if (this.isPatientRecording) {
          this.stopPatientTurnRecording();
        }
      };

      window.addEventListener('keydown', this.onWindowKeyDown);
      window.addEventListener('keyup', this.onWindowKeyUp);
      window.addEventListener('blur', this.onWindowBlur);
    }
  }

  removeEventListeners(): void {
    if (this.onWindowKeyDown) {
      window.removeEventListener('keydown', this.onWindowKeyDown);
      this.onWindowKeyDown = null;
    }

    if (this.onWindowKeyUp) {
      window.removeEventListener('keyup', this.onWindowKeyUp);
      this.onWindowKeyUp = null;
    }

    if (this.onWindowBlur) {
      window.removeEventListener('blur', this.onWindowBlur);
      this.onWindowBlur = null;
    }
  }

  toggleMute(): void {
    if (!this.myVideoStream) {
      return;
    }
    const audioTrack = this.myVideoStream.getAudioTracks()[0];
    if (!audioTrack) {
      this.showError('No audio track available to mute.');
      return;
    }
    audioTrack.enabled = !audioTrack.enabled;
    this.setMuteButtonState(audioTrack.enabled ? 'Mute' : 'Unmute');
  }

  isEditableTarget(target: EventTarget | null): boolean {
    return isEditableTargetFeature(target);
  }

  handlePushToTalkKeyDown(event: KeyboardEvent): void {
    handlePushToTalkKeyDownFeature(this, event);
  }

  handlePushToTalkKeyUp(event: KeyboardEvent): void {
    handlePushToTalkKeyUpFeature(this, event);
  }

  async getPatientTurnAudioStream(): Promise<MediaStream> {
    return getPatientTurnAudioStreamFeature(this);
  }

  async startPatientTurnRecording(): Promise<void> {
    return startPatientTurnRecordingFeature(this);
  }

  stopMediaStream(stream: MediaStream | null): void {
    stopMediaStreamFeature(stream);
  }

  stopPatientTurnRecording(): void {
    stopPatientTurnRecordingFeature(this);
  }

  cleanupPatientTurnRecorder(): void {
    cleanupPatientTurnRecorderFeature(this);
  }

  normalizeConversation(conversation: unknown[]): ConversationItem[] {
    return conversation
      .filter(item => item && typeof item === 'object')
      .filter((item): item is ConversationItem => {
        const maybeItem = item as Partial<ConversationItem>;
        return (maybeItem.role === 'user' || maybeItem.role === 'assistant')
          && typeof maybeItem.content === 'string';
      })
      .map(item => ({ role: item.role, content: item.content }));
  }

  async transcribePatientTurn(audioBlob: Blob): Promise<string> {
    return transcribePatientAudioTurn({
      audioBlob,
      apiBaseUrl: CONFIG.API_BASE_URL,
      endpoint: CONFIG.PATIENT_TRANSCRIBE_ENDPOINT,
      clientId: this.myPeerId || 'local-user'
    });
  }

  async getPatientReply(userText: string): Promise<string> {
    const conversation = this
      .normalizeConversation(this.patientConversation)
      .slice(-CONFIG.PATIENT_MAX_CONVERSATION_ITEMS);
    const userMessage: ConversationItem = { role: 'user', content: userText };
    conversation.push(userMessage);

    const reply = await fetchPatientChatReply({
      conversation,
      apiBaseUrl: CONFIG.API_BASE_URL,
      endpoint: CONFIG.PATIENT_CHAT_ENDPOINT
    });

    const assistantMessage: ConversationItem = { role: 'assistant', content: reply };
    this.patientConversation = [...conversation, assistantMessage]
      .slice(-CONFIG.PATIENT_MAX_CONVERSATION_ITEMS);
    return reply;
  }

  async synthesizePatientSpeech(replyText: string): Promise<Blob> {
    return synthesizePatientSpeechBlob({
      replyText,
      apiBaseUrl: CONFIG.API_BASE_URL,
      endpoint: CONFIG.PATIENT_TTS_ENDPOINT
    });
  }

  async getAudioBlobDurationSeconds(audioBlob: Blob): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      const url = URL.createObjectURL(audioBlob);

      const cleanup = () => {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      };

      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        cleanup();
        if (Number.isFinite(duration) && duration > 0) {
          resolve(duration);
        } else {
          reject(new Error('Invalid audio duration'));
        }
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('Could not read audio metadata'));
      };
      audio.src = url;
    });
  }

  async animateAvatarFromText(replyText: string, durationSeconds: number): Promise<boolean> {
    if (!this.aiPatientHead || typeof this.aiPatientHead.speakAudio !== 'function') {
      return false;
    }

    const timing = buildApproxWordTimings(replyText, durationSeconds);
    if (!timing.words.length) {
      return false;
    }

    try {
      const audioCtx = this.aiPatientHead.audioCtx;
      if (!audioCtx || typeof audioCtx.createBuffer !== 'function') {
        return false;
      }

      if (audioCtx.state !== 'running') {
        await audioCtx.resume();
      }

      const safeDuration = Math.max(0.2, durationSeconds);
      const sampleRate = Math.min(audioCtx.sampleRate, 16000);
      const frameCount = Math.max(1, Math.round(safeDuration * sampleRate));
      const silentAudio = audioCtx.createBuffer(1, frameCount, sampleRate);

      if (typeof this.aiPatientHead.stopSpeaking === 'function') {
        this.aiPatientHead.stopSpeaking();
      }
      this.aiPatientHead.speakAudio(
        {
          audio: silentAudio,
          words: timing.words,
          wtimes: timing.wtimes,
          wdurations: timing.wdurations
        },
        { lipsyncLang: 'fi', isRaw: true }
      );
      return true;
    } catch (error) {
      console.warn('Avatar lipsync-only animation failed:', error);
      return false;
    }
  }

  primePatientSpeechPath(): void {
    if (this.isPatientSpeechPathPrimed) {
      return;
    }
    if (!this.aiPatientHead || typeof this.aiPatientHead.speakAudio !== 'function') {
      return;
    }

    const audioCtx = this.aiPatientHead.audioCtx;
    if (!audioCtx || typeof audioCtx.createBuffer !== 'function' || audioCtx.state !== 'running') {
      return;
    }

    try {
      const frameCount = Math.max(1, Math.round(audioCtx.sampleRate * 0.05));
      const silentAudio = audioCtx.createBuffer(1, frameCount, audioCtx.sampleRate);
      this.aiPatientHead.speakAudio(
        {
          audio: silentAudio,
          words: [],
          wtimes: [],
          wdurations: []
        },
        { lipsyncLang: 'fi', isRaw: true }
      );
      this.isPatientSpeechPathPrimed = true;
    } catch (error) {
      console.warn('Patient speech warmup failed:', error);
    }
  }

  stopPatientSpeech(): void {
    this.patientAudio.pause();
    this.patientAudio.currentTime = 0;
    if (this.aiPatientHead && typeof this.aiPatientHead.stopSpeaking === 'function') {
      this.aiPatientHead.stopSpeaking();
    }
    this.detachPatientAudioSource();
    this.revokePatientAudioUrl();
  }

  detachPatientAudioSource(): void {
    this.patientAudio.removeAttribute('src');
    this.patientAudio.load();
  }

  revokePatientAudioUrl(): void {
    if (!this.patientAudioUrl) {
      return;
    }
    URL.revokeObjectURL(this.patientAudioUrl);
    this.patientAudioUrl = null;
  }

  async playPatientSpeech(audioBlob: Blob, replyText = ''): Promise<void> {
    if (!audioBlob) {
      return;
    }

    this.stopPatientSpeech();
    const durationSeconds = await this.getAudioBlobDurationSeconds(audioBlob);

    this.patientAudioUrl = URL.createObjectURL(audioBlob);
    this.patientAudio.src = this.patientAudioUrl;
    try {
      await this.patientAudio.play();
      if (this.aiPatientHead && typeof this.aiPatientHead.speakAudio === 'function') {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        void this.animateAvatarFromText(replyText, durationSeconds);
      }
    } catch (error) {
      this.stopPatientSpeech();
      throw error;
    }
  }

  async processPatientTurn(audioBlob: Blob): Promise<void> {
    if (!audioBlob || audioBlob.size === 0) {
      this.emitPatientTurnState();
      return;
    }

    if (this.isPatientProcessing) {
      return;
    }

    this.isPatientProcessing = true;
    this.emitPatientTurnState();

    try {
      const transcript = await this.transcribePatientTurn(audioBlob);
      if (!transcript) {
        return;
      }

      const reply = await this.getPatientReply(transcript);
      const speech = await this.synthesizePatientSpeech(reply);
      await this.playPatientSpeech(speech, reply);
    } catch (error) {
      console.error('Patient turn failed:', error);
      this.showError('AI patient response failed. Check API logs for details.');
    } finally {
      this.isPatientProcessing = false;
      this.emitPatientTurnState();
    }
  }

  navigateToAnalysis(): void {
    const locale: AppLocale = document.documentElement.lang.toLowerCase().startsWith('fi') ? 'fi' : 'en';
    queueLocaleForNextPage(locale);
    sessionStorage.setItem('responseData', JSON.stringify(this.responseData));
    window.location.href = this.analysisPath;
  }

  initializePeerConnection(): void {
    initializePeerConnectionFeature(this);
  }

  async handleCall(call: PeerCallLike): Promise<void> {
    return handleCallFeature(this, call);
  }

  handleUserConnected(userId: string): void {
    handleUserConnectedFeature(this, userId);
  }

  handleUserDisconnected(userId: string): void {
    handleUserDisconnectedFeature(this, userId);
  }

  async connectToNewUser(userId: string): Promise<void> {
    return connectToNewUserFeature(this, userId);
  }

  disconnectVideoCall(): void {
    this.removeEventListeners();
    disconnectVideoCallFeature(this);
    if (this.uiCallbacks.onVideoTileRemove) {
      this.uiCallbacks.onVideoTileRemove('local-preview');
      this.remoteVideoElements.forEach((_video, userId) => {
        this.uiCallbacks.onVideoTileRemove?.(userId);
      });
    }
    this.remoteVideoElements.forEach(video => {
      video.srcObject = null;
      video.remove();
    });
    this.remoteVideoElements.clear();
    if (this.myVideo && this.myVideo.isConnected) {
      this.myVideo.srcObject = null;
      this.myVideo.remove();
    }
    if (this.aiPatientSlot && this.ownsAIPatientSlot) {
      this.aiPatientSlot.remove();
    }
    this.aiPatientSlot = null;
  }

  processAudioStream(stream: MediaStream, userId: string): void {
    processAudioStreamFeature(this, stream, userId);
  }

  async toggleAnalysis(): Promise<void> {
    return toggleAnalysisFeature(this);
  }

  endAnalysisAndCall(): void {
    endAnalysisAndCallFeature(this);
  }

  async startAnalysis(): Promise<boolean> {
    return startAnalysisFeature(this);
  }

  stopAnalysis(): void {
    stopAnalysisFeature(this);
  }

  startAudioRecording(stream: MediaStream): void {
    startAudioRecordingFeature(this, stream);
  }

  stopAudioRecording(): boolean {
    return stopAudioRecordingFeature(this);
  }

  async sendAudioToAPI(audioBlob: Blob, audioFilename: string | null = null): Promise<void> {
    return sendAudioToAPIFeature(this, audioBlob, audioFilename);
  }

  async captureAndSendFrame(): Promise<void> {
    return captureAndSendFrameFeature(this);
  }

  canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return canvasToJpegBlobFeature(canvas);
  }

  async sendFrameToAPI(blob: Blob | null, timestamp: number): Promise<void> {
    return sendFrameToAPIFeature(this, blob, timestamp);
  }

  showProcessingIndicator(show: boolean): void {
    this.emitRoomProcessingState({
      visible: show,
      mode: 'processing',
      message: 'Processing audio data...'
    });
  }

  showProcessingSuccess(): void {
    this.emitRoomProcessingState({
      visible: true,
      mode: 'success',
      message: 'Analysis processing complete.'
    });
    this.setMuteButtonState(undefined, this.isDisconnected);
    setTimeout(() => {
      this.showProcessingIndicator(false);
    }, 10000);
  }

  showProcessingError(): void {
    this.emitRoomProcessingState({
      visible: true,
      mode: 'error',
      message: 'Error processing audio. You can continue the call.'
    });
    this.setMuteButtonState(undefined, this.isDisconnected);
    setTimeout(() => {
      this.showProcessingIndicator(false);
    }, 10000);
  }

  showError(message: string): void {
    if (this.uiCallbacks.onError) {
      this.uiCallbacks.onError(message);
    } else {
      console.error(message);
    }
  }

  emitRoomControlState(): void {
    const state: RoomControlsState = {
      muteLabel: this.muteLabelText,
      muteDisabled: this.muteButton.disabled,
      analysisLabel: this.analysisLabelText,
      analysisDisabled: this.analysisToggle.disabled
    };

    this.uiCallbacks.onControlsChange?.(state);
  }

  emitRoomProcessingState(state: RoomProcessingState): void {
    this.uiCallbacks.onProcessingChange?.(state);
  }

  emitPatientTurnState(): void {
    if (!this.enableAIPatient) {
      return;
    }

    const state: PatientTurnUiState = this.isPatientProcessing
      ? {
        message: 'Processing patient response...',
        active: false,
        disabled: true
      }
      : this.isPatientRecording
        ? {
          message: 'Listening...',
          active: true,
          disabled: false
        }
        : {
          message: 'Hold Push to Talk or press Space.',
          active: false,
          disabled: this.isDisconnected
        };

    this.uiCallbacks.onPatientTurnStateChange?.(state);
  }

  setMuteButtonState(label?: string, disabled?: boolean): void {
    if (typeof label === 'string') {
      this.muteLabelText = label;
      if (!this.uiCallbacks.onControlsChange) {
        this.muteButton.textContent = label;
      }
    }
    if (typeof disabled === 'boolean') {
      this.muteButton.disabled = disabled;
    }
    this.emitRoomControlState();
  }

  setAnalysisToggleState(label?: string, disabled?: boolean): void {
    if (typeof label === 'string') {
      this.analysisLabelText = label;
      if (!this.uiCallbacks.onControlsChange) {
        this.analysisToggle.textContent = label;
      }
    }
    if (typeof disabled === 'boolean') {
      this.analysisToggle.disabled = disabled;
    }
    this.emitRoomControlState();
  }
}
