import type {
  PeerCallLike,
  RoomAppPeerContext
} from './types.js';

function getPeerErrorType(error: unknown): string {
  if (error && typeof error === 'object' && 'type' in error) {
    const errorType = (error as { type?: unknown }).type;
    if (typeof errorType === 'string' && errorType) {
      return errorType;
    }
  }
  return 'unknown';
}

export function initializePeerConnection(app: RoomAppPeerContext): void {
  const peer = app.myPeer;
  if (!peer) {
    app.showError('Peer connection is not available.');
    return;
  }

  peer.on('open', (id: string) => {
    app.myPeerId = id;
    app.socket.emit('join-room', app.roomId, id);
  });

  peer.on('call', (call: PeerCallLike) => {
    void app.handleCall(call);
  });

  app.socket.on('user-connected', (userId: string) => app.handleUserConnected(userId));
  app.socket.on('user-disconnected', (userId: string) => app.handleUserDisconnected(userId));

  peer.on('error', error => {
    console.error('PeerJS error:', error);
    app.showError(`Connection error: ${getPeerErrorType(error)}`);
  });
}

export async function handleCall(app: RoomAppPeerContext, call: PeerCallLike): Promise<void> {
  if (app.isDisconnected || !app.myPeer) {
    call.close();
    return;
  }

  if (app.connectedUsers.includes(call.peer)) {
    console.log('User already connected:', call.peer);
    return;
  }

  const localStream = await app.ensureLocalStreamReady();
  if (!localStream) {
    console.warn('Cannot answer call without local media stream');
    call.close();
    return;
  }

  app.connectedUsers.push(call.peer);
  call.answer(localStream);

  const video = app.createVideoElement();
  call.on('stream', (userVideoStream: MediaStream) => {
    app.addVideoStream(video, userVideoStream, call.peer);
    app.processAudioStream(userVideoStream, call.peer);
  });

  call.on('close', () => {
    app.removeVideoStream(call.peer);
  });

  app.peers[call.peer] = call;
}

export function handleUserConnected(app: RoomAppPeerContext, userId: string): void {
  if (app.isDisconnected || !app.myPeer) {
    return;
  }

  if (app.connectedUsers.includes(userId) || app.peers[userId]) {
    console.log('User already connected:', userId);
    return;
  }

  const timeoutId = setTimeout(() => {
    app.pendingConnectTimeouts.delete(timeoutId);
    app.connectToNewUser(userId);
  }, 2000);
  app.pendingConnectTimeouts.add(timeoutId);
}

export function handleUserDisconnected(app: RoomAppPeerContext, userId: string): void {
  if (app.peers[userId]) {
    app.peers[userId].close();
    delete app.peers[userId];
    app.removeVideoStream(userId);
  }
}

export async function connectToNewUser(app: RoomAppPeerContext, userId: string): Promise<void> {
  if (app.isDisconnected || !app.myPeer || app.myPeer.destroyed || app.connectedUsers.includes(userId) || app.peers[userId]) {
    return;
  }

  const localStream = await app.ensureLocalStreamReady();
  if (!localStream || !app.myPeer || app.myPeer.destroyed || app.isDisconnected) {
    console.warn('Cannot connect to new user without local media stream');
    return;
  }

  const call = app.myPeer.call(userId, localStream);
  if (!call) {
    return;
  }
  const video = app.createVideoElement();

  call.on('stream', (userVideoStream: MediaStream) => {
    app.addVideoStream(video, userVideoStream, userId);
    app.processAudioStream(userVideoStream, userId);
  });

  call.on('close', () => {
    app.removeVideoStream(userId);
  });

  call.on('error', error => {
    console.error('Call error:', error);
    app.removeVideoStream(userId);
  });

  app.peers[userId] = call;
}

export function disconnectVideoCall(app: RoomAppPeerContext): void {
  if (app.isDisconnected) {
    return;
  }
  app.isDisconnected = true;
  app.captureLoopToken += 1;
  app.captureLoopActive = false;
  app.captureLoopPromise = null;

  if (app.isPatientRecording) {
    app.stopPatientTurnRecording();
  }
  app.cleanupPatientTurnRecorder();
  app.stopPatientSpeech();
  app.emitPatientTurnState();
  app.pendingConnectTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
  app.pendingConnectTimeouts.clear();

  Object.values(app.peers).forEach(peer => peer.close());

  if (app.myVideoStream) {
    app.myVideoStream.getTracks().forEach(track => track.stop());
    app.myVideoStream = null;
  }

  if (app.analysisAudioStream) {
    app.analysisAudioStream.getTracks().forEach(track => track.stop());
    app.analysisAudioStream = null;
  }

  if (app.myPeer) {
    app.myPeer.removeAllListeners();
    app.myPeer.destroy();
    app.myPeer = null;
  }

  app.remoteAudioContexts.forEach((audioContext) => {
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
  });
  app.remoteAudioContexts.clear();

  if (app.myVideo) {
    app.myVideo.srcObject = null;
  }

  app.socket.disconnect();
  Object.keys(app.peers).forEach(key => delete app.peers[key]);

  if (app.aiPatientHead && typeof app.aiPatientHead.stop === 'function') {
    app.aiPatientHead.stop();
  }
}

export function processAudioStream(app: RoomAppPeerContext, stream: MediaStream, userId: string): void {
  if (!userId) {
    return;
  }

  try {
    app.closeRemoteAudioContext(userId);
    const AudioContextCtor = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    const audioContext = new AudioContextCtor();
    const audioSource = audioContext.createMediaStreamSource(stream);
    audioSource.connect(audioContext.destination);
    app.remoteAudioContexts.set(userId, audioContext);
  } catch (error) {
    console.error('Error processing audio stream:', error);
  }
}
