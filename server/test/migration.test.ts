import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('migrateLegacyNarrators', () => {
  it('moves kind:narrator characters to narrators and leaves id intact', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'zd-narr-'));
    process.env.ZD_RPS_DATA = tmp;
    try {
      vi.resetModules();
      const { migrateLegacyNarrators, createStore, loadStore } = await import('../src/store.js');

      const charDir = path.join(tmp, 'characters', 'c-narr');
      await mkdir(path.join(tmp, 'characters'), { recursive: true });
      await mkdir(charDir, { recursive: true });
      await writeFile(
        path.join(tmp, 'characters', 'c-narr.json'),
        JSON.stringify({
          id: 'c-narr',
          kind: 'narrator',
          name: 'The Narrator',
          description: 'x',
          avatarPath: '/media/characters/c-narr/avatar.png',
          voiceSamplePath: '/media/characters/c-narr/voice-sample.wav',
          voiceSampleTranscript: 'a sample',
          created: '2026-01-01T00:00:00.000Z',
          updated: '2026-01-01T00:00:00.000Z',
        }),
      );
      await writeFile(path.join(charDir, 'avatar.png'), Buffer.from('img'));
      await writeFile(path.join(charDir, 'voice-sample.wav'), Buffer.from('wav'));

      await migrateLegacyNarrators();

      const narratorFile = path.join(tmp, 'narrators', 'c-narr.json');
      const migrated = JSON.parse(await readFile(narratorFile, 'utf8'));
      expect(migrated.id).toBe('c-narr');
      expect(migrated.name).toBe('The Narrator');
      expect(migrated.voiceSamplePath).toBe('/media/narrators/c-narr/voice-sample.wav');
      expect(migrated.avatarPath).toBe('/media/narrators/c-narr/avatar.png');
      expect(migrated.voiceSampleTranscript).toBe('a sample');

      const movedAudio = await readFile(path.join(tmp, 'narrators', 'c-narr', 'voice-sample.wav'));
      expect(movedAudio.equals(Buffer.from('wav'))).toBe(true);

      const charsAfter = await readdir(path.join(tmp, 'characters'));
      expect(charsAfter).toEqual([]);

      const store = createStore();
      await loadStore(store);
      expect(store.characters.list()).toHaveLength(0);
      expect(store.narrators.list().map((n) => n.name)).toEqual(['The Narrator']);
      expect(store.narrators.list()[0].id).toBe('c-narr');
    } finally {
      await rm(tmp, { recursive: true, force: true });
      delete process.env.ZD_RPS_DATA;
    }
  });

  it('leaves plain characters alone', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'zd-narr-'));
    process.env.ZD_RPS_DATA = tmp;
    try {
      vi.resetModules();
      const { migrateLegacyNarrators } = await import('../src/store.js');
      const charDir = path.join(tmp, 'characters', 'c-amy');
      await mkdir(path.join(tmp, 'characters'), { recursive: true });
      await mkdir(charDir, { recursive: true });
      await writeFile(
        path.join(charDir, 'character.json'),
        JSON.stringify({ id: 'c-amy', name: 'Amy', description: '', personality: '' }),
      );

      await migrateLegacyNarrators();

      const charsAfter = await readdir(path.join(tmp, 'characters'));
      expect(charsAfter).toEqual(['c-amy']);
      const narratorsDir = path.join(tmp, 'narrators');
      const narratorsAfter = await readdir(narratorsDir).catch(() => []);
      expect(narratorsAfter).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
      delete process.env.ZD_RPS_DATA;
    }
  });
});