import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = process.env.ZD_RPS_ROOT
  ? path.resolve(process.env.ZD_RPS_ROOT)
  : path.resolve(here, '..', '..');

export const DATA_DIR = process.env.ZD_RPS_DATA
  ? path.resolve(process.env.ZD_RPS_DATA)
  : path.join(ROOT, 'data');

export const CONFIG_PATH = process.env.ZD_RPS_CONFIG
  ? path.resolve(process.env.ZD_RPS_CONFIG)
  : path.join(ROOT, 'config.json');

export const DIR = {
  characters: path.join(DATA_DIR, 'characters'),
  narrators: path.join(DATA_DIR, 'narrators'),
  personas: path.join(DATA_DIR, 'personas'),
  groups: path.join(DATA_DIR, 'groups'),
  lorebooks: path.join(DATA_DIR, 'lorebooks'),
  scenarios: path.join(DATA_DIR, 'scenarios'),
  chats: path.join(DATA_DIR, 'chats'),
  audio: path.join(DATA_DIR, 'media', 'audio'),
  images: path.join(DATA_DIR, 'media', 'images'),
} as const;