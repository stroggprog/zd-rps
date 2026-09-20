import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createStore, loadStore } from './store.js';
import { createVoiceCache } from './voices.js';
import { loadConfig } from './config.js';
import { DIR, ROOT } from './paths.js';
import { connectionsRouter } from './routes/connections.js';
import { catalog } from './providers/factory.js';
import { charactersRouter } from './routes/characters.js';
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
  app.use('/api/connections', connectionsRouter(ctx));
  app.use('/api/characters', charactersRouter(ctx));
  app.use('/api/lorebooks', lorebooksRouter(ctx));
  app.use('/api/scenarios', scenariosRouter(ctx));
  app.use('/api/chats', chatsRouter(ctx));
  app.use('/api/audio', audioRouter(ctx));

  app.use('/media/characters', express.static(DIR.characters));
  app.use('/media/audio', express.static(DIR.audio));
  app.use('/media/images', express.static(DIR.images));

  const webDist = path.join(ROOT, 'web', 'dist');
  if (existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorMiddleware);

  const server = app.listen(PORT, () => {
    console.log(`zd-rps server listening on http://localhost:${PORT}`);
  });

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