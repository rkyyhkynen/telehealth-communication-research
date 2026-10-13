import { readMetaContent } from '../lib/meta';
import type { PeerLike, SocketLike } from './core/types';

type ViewMode = 'classic' | 'avatar';

type PeerConstructor = new (id?: string, options?: unknown) => PeerLike;
type IoFactory = (namespace?: string) => SocketLike;

export type RoomRuntimeConfig = {
  roomId: string;
  viewMode: ViewMode;
  enableAIPatient: boolean;
  avatarModuleUrl: string;
  avatarModelUrl: string;
  classicRoomPath: string;
  avatarRoomPath: string;
};

const DEFAULT_AVATAR_MODULE_URL = '/vendor/talkinghead/modules/talkinghead.mjs';
const DEFAULT_AVATAR_MODEL_URL = '/vendor/talkinghead/avatars/david.glb';
let cachedPeerConstructor: PeerConstructor | null = null;
let cachedSocketIoFactory: IoFactory | null = null;

function normalizeRoomId(roomId: string): string {
  const normalized = roomId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!normalized) {
    throw new Error('Room ID is required in the URL path.');
  }
  return normalized;
}

function getPathFallbacks() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const routeIndex = segments[0] === 'react' ? 1 : 0;
  const routeSegment = segments[routeIndex] || '';
  const roomSegment = segments[routeIndex + 1] || '';
  const viewMode: ViewMode = routeSegment === 'avatar' ? 'avatar' : 'classic';
  const roomId = normalizeRoomId(roomSegment);
  return { viewMode, roomId };
}

export function resolveRoomRuntimeConfig(): RoomRuntimeConfig {
  const pathFallbacks = getPathFallbacks();
  const metaRoomId = readMetaContent('app-room-id', '').trim();
  const roomId = normalizeRoomId(metaRoomId || pathFallbacks.roomId);
  const viewMode: ViewMode = pathFallbacks.viewMode;

  const aiPatientMeta = readMetaContent('app-enable-ai-patient', '').trim();
  const enableAIPatient = viewMode === 'avatar' || aiPatientMeta === '1';
  const avatarModuleUrl = readMetaContent('app-avatar-module-url', DEFAULT_AVATAR_MODULE_URL)
    || DEFAULT_AVATAR_MODULE_URL;
  const avatarModelUrl = readMetaContent('app-avatar-model-url', DEFAULT_AVATAR_MODEL_URL)
    || DEFAULT_AVATAR_MODEL_URL;
  const encodedRoomId = encodeURIComponent(roomId);

  return {
    roomId,
    viewMode,
    enableAIPatient,
    avatarModuleUrl,
    avatarModelUrl,
    classicRoomPath: `/room/${encodedRoomId}`,
    avatarRoomPath: `/avatar/${encodedRoomId}`
  };
}

export async function ensurePeerConstructor(): Promise<PeerConstructor> {
  if (cachedPeerConstructor) {
    return cachedPeerConstructor;
  }

  const peerModule = await import('peerjs');
  const peerCtor = (peerModule as { Peer?: unknown; default?: unknown }).Peer
    || (peerModule as { default?: unknown }).default;

  if (typeof peerCtor !== 'function') {
    throw new Error('PeerJS dependency is missing. Install dependencies and retry.');
  }

  cachedPeerConstructor = peerCtor as PeerConstructor;
  return cachedPeerConstructor;
}

export async function ensureSocketIoClient(): Promise<IoFactory> {
  if (cachedSocketIoFactory) {
    return cachedSocketIoFactory;
  }

  const socketModule = await import('socket.io-client');
  const ioFactory = (socketModule as { io?: unknown; default?: unknown }).io
    || (socketModule as { default?: unknown }).default;

  if (typeof ioFactory !== 'function') {
    throw new Error('Socket.IO client dependency is missing. Install dependencies and retry.');
  }

  cachedSocketIoFactory = ioFactory as IoFactory;
  return cachedSocketIoFactory;
}
