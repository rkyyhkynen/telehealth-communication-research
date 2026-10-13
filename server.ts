import express = require('express');
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { Server as SocketIOServer } from 'socket.io';

type ReactRoomRequest = {
  params: {
    room: string;
  };
};

type StaticResponse = {
  status: (code: number) => StaticResponse;
  send: (body: string) => void;
  sendFile: (file: string, callback?: (error: Error | null) => void) => void;
};

function getProjectRoot(): string {
  const parentDir = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(parentDir, 'package.json'))) {
    return parentDir;
  }
  return __dirname;
}

const app = express();
const ipAddress = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 3000;

const projectRoot = getProjectRoot();
const certsDir = path.join(projectRoot, 'certs');
const nodeModulesDir = path.join(projectRoot, 'node_modules');

const serverOptions = {
  key: fs.readFileSync(path.join(certsDir, 'key.pem')),
  cert: fs.readFileSync(path.join(certsDir, 'cert.pem'))
};

const server = https.createServer(serverOptions, app);
const io = new SocketIOServer(server);

app.use(express.static(path.join(projectRoot, 'public')));
app.use(express.static(path.join(projectRoot, 'public/react')));
app.use('/vendor/three', express.static(path.join(nodeModulesDir, 'three')));
app.use('/vendor/talkinghead', express.static(path.join(projectRoot, 'vendor/talkinghead')));

app.get('/analysis', (_req: unknown, res: StaticResponse) => {
  res.sendFile(path.join(projectRoot, 'public/react/web/analysis.html'), error => {
    if (error) {
      res.status(503).send('React build missing. Run "npm run web:build".');
    }
  });
});

app.get('/room', (_req: unknown, res: StaticResponse) => {
  res.status(400).send('Missing room ID. Open /room/<room-id>.');
});

app.get('/avatar', (_req: unknown, res: StaticResponse) => {
  res.status(400).send('Missing room ID. Open /avatar/<room-id>.');
});

function sendReactRoom(res: StaticResponse) {
  res.sendFile(path.join(projectRoot, 'public/react/web/room.html'), error => {
    if (error) {
      res.status(503).send('React build missing. Run "npm run web:build".');
    }
  });
}

app.get('/room/:room', (_req: ReactRoomRequest, res: StaticResponse) => {
  sendReactRoom(res);
});

app.get('/avatar/:room', (_req: ReactRoomRequest, res: StaticResponse) => {
  sendReactRoom(res);
});

io.on('connection', socket => {
  socket.on('join-room', (roomId: string, userId: string) => {
    socket.join(roomId);
    socket.broadcast.to(roomId).emit('user-connected', userId);

    socket.on('disconnect', () => {
      socket.broadcast.to(roomId).emit('user-disconnected', userId);
    });
  });
});

server.listen(port, ipAddress, () => {
  console.log(`Server running on ${ipAddress}:${port}`);
});
