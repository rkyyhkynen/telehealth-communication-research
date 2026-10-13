import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  ensurePeerConstructor,
  ensureSocketIoClient,
  resolveRoomRuntimeConfig
} from './runtime';
import {
  applyLocaleToDocument,
  getLocaleButtonLabel,
  nextLocale,
  queueLocaleForNextPage,
  readStoredLocale,
  translateUiText,
  type AppLocale,
  writeStoredLocale
} from '../shared/locale';

type RoomAppHandle = {
  toggleMute: () => void;
  toggleAnalysis: () => Promise<void>;
  startPatientTurnRecording: () => Promise<void>;
  stopPatientTurnRecording: () => void;
  disconnectVideoCall: () => void;
};

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

type VideoTile = {
  id: string;
  stream: MediaStream;
  muted: boolean;
};

function StreamVideo(props: { tile: VideoTile }) {
  const { tile } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }

    element.srcObject = tile.stream;
    element.muted = tile.muted;
    void element.play().catch(() => {});

    return () => {
      if (element.srcObject === tile.stream) {
        element.srcObject = null;
      }
    };
  }, [tile.stream, tile.muted]);

  return <video ref={videoRef} />;
}

function RoomApp() {
  const [locale, setLocale] = useState<AppLocale>(() => readStoredLocale());
  const runtimeBootstrap = useMemo(() => {
    try {
      return {
        config: resolveRoomRuntimeConfig(),
        error: null as string | null
      };
    } catch (error) {
      return {
        config: null,
        error: error instanceof Error ? error.message : 'Invalid room URL.'
      };
    }
  }, []);
  const runtimeConfig = runtimeBootstrap.config;
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [controls, setControls] = useState<RoomControlsState>({
    muteLabel: 'Mute',
    muteDisabled: false,
    analysisLabel: 'Start video call',
    analysisDisabled: false
  });
  const [processingState, setProcessingState] = useState<RoomProcessingState>({
    visible: false,
    mode: 'processing',
    message: 'Processing audio data...'
  });
  const [patientTurnState, setPatientTurnState] = useState<PatientTurnUiState>({
    message: 'Hold Push to Talk or press Space.',
    active: false,
    disabled: false
  });
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([]);
  const videoGridRef = useRef<HTMLDivElement | null>(null);
  const aiPatientSlotRef = useRef<HTMLDivElement | null>(null);
  const muteButtonRef = useRef<HTMLButtonElement | null>(null);
  const analysisToggleRef = useRef<HTMLButtonElement | null>(null);
  const processingIndicatorRef = useRef<HTMLDivElement | null>(null);
  const roomAppRef = useRef<RoomAppHandle | null>(null);
  const tr = (text: string) => translateUiText(text, locale);

  useEffect(() => {
    writeStoredLocale(locale);
    applyLocaleToDocument(locale);
    document.title = locale === 'fi' ? 'Huone (React)' : 'Room (React)';
  }, [locale]);

  useEffect(() => {
    if (!runtimeConfig) {
      return undefined;
    }
    const config = runtimeConfig;

    let isUnmounted = false;
    let localRoomApp: RoomAppHandle | null = null;

    async function bootstrapRoom() {
      try {
        const ioFactory = await ensureSocketIoClient();
        const peerConstructor = await ensurePeerConstructor();
        if (isUnmounted) {
          return;
        }

        const { VideoChatApp } = await import('./core/videoChatApp');
        if (isUnmounted) {
          return;
        }

        const videoGrid = videoGridRef.current;
        const muteButton = muteButtonRef.current;
        const analysisToggle = analysisToggleRef.current;
        if (!videoGrid || !muteButton || !analysisToggle) {
          throw new Error('Room UI elements are not ready yet.');
        }

        localRoomApp = new VideoChatApp({
          ioFactory,
          peerConstructor,
          aiPatientContainer: aiPatientSlotRef.current,
          roomId: config.roomId,
          analysisPath: '/analysis',
          enableAIPatient: config.enableAIPatient,
          patientAvatarConfig: config.enableAIPatient
            ? {
              moduleUrl: config.avatarModuleUrl,
              modelUrl: config.avatarModelUrl
            }
            : null,
          elements: {
            videoGrid,
            muteButton,
            analysisToggle
          },
          uiCallbacks: {
            onError: (message: string) => {
              if (message.trim().length > 0) {
                setRuntimeError(message);
              }
            },
            onControlsChange: (state: RoomControlsState) => {
              setControls(state);
            },
            onProcessingChange: (state: RoomProcessingState) => {
              setProcessingState(state);
            },
            onPatientTurnStateChange: (state: PatientTurnUiState) => {
              setPatientTurnState(state);
            },
            onVideoTileUpsert: (tile: VideoTile) => {
              setVideoTiles(current => {
                const index = current.findIndex(item => item.id === tile.id);
                if (index === -1) {
                  return [...current, tile];
                }
                const next = [...current];
                next[index] = tile;
                return next;
              });
            },
            onVideoTileRemove: (tileId: string) => {
              setVideoTiles(current => current.filter(item => item.id !== tileId));
            }
          }
        });
        roomAppRef.current = localRoomApp;
      } catch (error) {
        if (isUnmounted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Room bootstrap failed.';
        setBootstrapError(message);
      }
    }

    void bootstrapRoom();
    return () => {
      isUnmounted = true;
      localRoomApp?.disconnectVideoCall();
      setVideoTiles([]);
      roomAppRef.current = null;
    };
  }, [runtimeConfig]);

  if (runtimeBootstrap.error || !runtimeConfig) {
    return (
      <main className="container">
        <div
          role="alert"
          style={{
            marginBottom: '16px',
            borderRadius: '6px',
            padding: '12px 14px',
            background: '#fef3f2',
            color: '#b42318',
            border: '1px solid #fecdca'
          }}
        >
          {tr(runtimeBootstrap.error || 'Missing room configuration.')}
          {' '}
          {tr('Use /room/<room-id> or /avatar/<room-id>.')}
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="view-switch">
        <a
          className={`button ${runtimeConfig.viewMode === 'classic' ? 'is-active' : ''}`}
          href={runtimeConfig.classicRoomPath}
          onClick={() => queueLocaleForNextPage(locale)}
        >
          {tr('Classic Call')}
        </a>
        <a
          className={`button ${runtimeConfig.viewMode === 'avatar' ? 'is-active' : ''}`}
          href={runtimeConfig.avatarRoomPath}
          onClick={() => queueLocaleForNextPage(locale)}
        >
          {tr('Avatar Patient')}
        </a>
        <button
          type="button"
          className="button button-lang"
          onClick={() => setLocale(current => nextLocale(current))}
        >
          {getLocaleButtonLabel(locale)}
        </button>
      </div>

      {bootstrapError ? (
        <div
          role="alert"
          style={{
            marginBottom: '16px',
            borderRadius: '6px',
            padding: '12px 14px',
            background: '#fef3f2',
            color: '#b42318',
            border: '1px solid #fecdca'
          }}
        >
          {tr(bootstrapError)}
        </div>
      ) : null}
      {!bootstrapError && runtimeError ? (
        <div
          role="alert"
          style={{
            marginBottom: '16px',
            borderRadius: '6px',
            padding: '12px 14px',
            background: '#fef3f2',
            color: '#b42318',
            border: '1px solid #fecdca'
          }}
        >
          {tr(runtimeError)}
        </div>
      ) : null}

      <div id="video-grid" ref={videoGridRef}>
        {videoTiles.map(tile => (
          <StreamVideo key={tile.id} tile={tile} />
        ))}
        {runtimeConfig.enableAIPatient ? (
          <div id="ai-patient-slot" ref={aiPatientSlotRef} className="ai-patient-slot" />
        ) : null}
      </div>
      <div className="controls">
        <button
          id="muteButton"
          ref={muteButtonRef}
          className="button"
          disabled={controls.muteDisabled}
          onClick={() => roomAppRef.current?.toggleMute()}
        >
          {tr(controls.muteLabel)}
        </button>
        <button
          id="analysisToggle"
          ref={analysisToggleRef}
          className="button"
          disabled={controls.analysisDisabled}
          onClick={() => { void roomAppRef.current?.toggleAnalysis(); }}
        >
          {tr(controls.analysisLabel)}
        </button>
      </div>
      {runtimeConfig.enableAIPatient ? (
        <>
          <div className="patient-talk-controls">
            <button
              type="button"
              className={`button patient-talk-button${patientTurnState.active ? ' is-active' : ''}`}
              disabled={patientTurnState.disabled}
              onPointerDown={event => {
                event.preventDefault();
                void roomAppRef.current?.startPatientTurnRecording();
              }}
              onPointerUp={event => {
                event.preventDefault();
                roomAppRef.current?.stopPatientTurnRecording();
              }}
              onPointerLeave={() => {
                roomAppRef.current?.stopPatientTurnRecording();
              }}
              onPointerCancel={() => {
                roomAppRef.current?.stopPatientTurnRecording();
              }}
            >
              {tr('Push to Talk')}
            </button>
          </div>
          <p className="controls-help-text" aria-live="polite">
            {tr(patientTurnState.message)}
          </p>
        </>
      ) : null}
      <div id="processingIndicator" ref={processingIndicatorRef} style={{ display: processingState.visible ? 'block' : 'none' }}>
        {processingState.mode === 'processing' ? (
          <div className="spinner" />
        ) : null}
        {processingState.mode === 'success' ? (
          <div className="success-checkmark">
            <div className="check-icon">✓</div>
          </div>
        ) : null}
        {processingState.mode === 'error' ? (
          <div className="error-icon">❌</div>
        ) : null}
        <p>{tr(processingState.message)}</p>
      </div>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <RoomApp />
);
