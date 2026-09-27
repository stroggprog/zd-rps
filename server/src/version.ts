import { execFile } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { asyncHandler } from './routes/helpers.js';
import { Router } from 'express';
import { ROOT } from './paths.js';

export interface VersionInfo {
  current: string;
  built?: string;
  latest: string | null;
  updateAvailable: boolean;
}

const VERSION_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'version.json');

function runningCommit(): { commit: string; built?: string } {
  try {
    const raw = JSON.parse(readFileSync(path.join(ROOT, 'server', 'dist', 'version.json'), 'utf8')) as {
      commit: string;
      built?: string;
    };
    return raw;
  } catch {
    return { commit: 'unknown' };
  }
}

/** One-hour cache so requests don't git-ls-remote constantly. */
let cache: { latest: string | null; updateAvailable: boolean; checkedAt: string } | null = null;

export async function checkUpstream(): Promise<{ latest: string | null; updateAvailable: boolean }> {
  if (cache && Date.now() - new Date(cache.checkedAt).getTime() < 60 * 60 * 1000) {
    const { latest, updateAvailable } = cache;
    return { latest, updateAvailable };
  }
  const stdout: string = await new Promise((resolve) => {
    execFile('git', ['ls-remote', 'origin', 'HEAD'], { cwd: ROOT, timeout: 10_000 }, (err, out) =>
      resolve(err ? '' : out.toString()),
    );
  });
  const line = stdout.split('\n').find((l) => l.includes('HEAD')) ?? '';
  const latest = line.split('\t')[0] || null;
  let updateAvailable = false;
  const { commit: current } = runningInfo();
  if (latest && current !== 'unknown') {
    updateAvailable = latest !== current;
  }
  cache = { latest, updateAvailable, checkedAt: new Date().toISOString() };
  return { latest, updateAvailable };
}

export function versionRouter(): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const running = runningInfo();
      const upstream = await checkUpstream().catch(() => ({ latest: null, updateAvailable: false }));
      res.json({ ...running, ...upstream });
    }),
  );

  return router;
}

function runningInfo(): { commit: string; built?: string } {
  try {
    const raw = JSON.parse(readFileSync(VERSION_FILE, 'utf8')) as { commit: string; built?: string };
    return raw;
  } catch {
    return { commit: 'unknown' };
  }
}
