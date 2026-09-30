import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createStore, loadStore } from './store.js';
import { createVoiceCache } from './voices.js';
import { loadConfig } from './config.js';
import { DATA_DIR, DIR, ROOT } from './paths.js';
import { connectionsRouter } from './routes/connections.js';
import { catalog } from './providers/factory.js';
import { charactersRouter } from './routes/characters.js';
import { narratorsRouter } from './routes/narrators.js';
import { personasRouter } from './routes/personas.js';
import { groupsRouter } from './routes/groups.js';
import { versionRouter } from './version.js';
import { storiesRouter } from './routes/stories.js';
import { lorebooksRouter } from './routes/lorebooks.js';
import { scenariosRouter } from './routes/scenarios.js';
import { chatsRouter } from './routes/chats.js';
import { audioRouter } from './routes/audio.js';
import { errorMiddleware } from './routes/helpers.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  await loadConfig();
  const store = createStore();
  await loadStore(store);
  const voiceCache = await createVoiceCache();

  const ctx = { store, voiceCache };

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const upload = multer({ storage: multer.memoryStorage() });
  app.use('/api', upload.any());

  app.get('/api/providers', (_req, res) => {
    res.json(catalog);
  });
  app.use('/api/version', versionRouter());
  app.use('/api/connections', connectionsRouter(ctx));
  app.use('/api/characters', charactersRouter(ctx));
  app.use('/api/narrators', narratorsRouter(ctx));
  app.use('/api/personas', personasRouter(ctx));
  app.use('/api/groups', groupsRouter(ctx));
  app.use('/api/stories', storiesRouter(ctx));
  app.use('/api/lorebooks', lorebooksRouter(ctx));
  app.use('/api/scenarios', scenariosRouter(ctx));
  app.use('/api/chats', chatsRouter(ctx));
  app.use('/api/audio', audioRouter(ctx));

  const mediaNoCache = {
    etag: true,
    setHeaders: (res: express.Response) => {
      // Avatars/voice samples are replaced in place at the same URL (editors,
      // TTS reference playback) — force revalidation so updated files are used.
      res.setHeader('Cache-Control', 'no-cache');
    },
  };
  app.use('/media/characters', express.static(DIR.characters, mediaNoCache));
  app.use('/media/narrators', express.static(DIR.narrators, mediaNoCache));
  app.use('/media/personas', express.static(DIR.personas, mediaNoCache));
  app.use('/media/groups', express.static(DIR.groups, mediaNoCache));
  app.use('/media/audio', express.static(DIR.audio));
  app.use('/media/audiobook', express.static(path.join(DATA_DIR, 'audiobook')));

  const webDist = path.join(ROOT, 'web', 'dist');
  if (existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorMiddleware);

  // HTTPS support: point ZD_RPS_CERT and ZD_RPS_KEY at the certificate and
  // private key files (PEM). When both are set the server speaks https and
  // http clients are redirected. Otherwise plain http as before.
  const certFile = process.env.ZD_RPS_CERT;
  const keyFile = process.env.ZD_RPS_KEY;
  let server: import('node:http').Server | import('node:https').Server;
  if (certFile && keyFile) {
    const https = await import('node:https');
    server = https
      .createServer(
        {
          cert: readFileSync(certFile, 'utf8'),
          key: readFileSync(keyFile, 'utf8'),
        },
        app,
      )
      .listen(PORT, () => {
        console.log(`zd-rps server listening on https://localhost:${PORT}`);
      });
  } else {
    server = app.listen(PORT, () => {
      console.log(`zd-rps server listening on http://localhost:${PORT}`);
    });
  }

  const shutdown = async (signal: string) => {
    console.log(`\n${signal}: shutting down`);
    await voiceCache.flush();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});