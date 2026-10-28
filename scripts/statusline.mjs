// Runs the newest installed copilot-hud. /copilot-hud:setup copies this file to
// <copilot home>/plugins/copilot-hud/ and points the statusLine at it, so the
// status line keeps working when the plugin moves — a marketplace swap, a
// direct install migrated to a marketplace one, a reinstall — without running
// setup again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN = 'copilot-hud';

export function copilotHome() {
  const dir = process.env.COPILOT_HOME?.trim();
  if (!dir) return path.join(os.homedir(), '.copilot');
  return dir === '~' || dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(1)) : dir;
}

/**
 * Parse one of Copilot's JSON files. `config.json` opens with `//` comment
 * lines ("This file is managed automatically"), which JSON.parse rejects.
 */
export function parseCopilotJson(text) {
  const lines = text.replace(/^﻿/, '').split('\n');
  let start = 0;
  while (start < lines.length && /^\s*(\/\/.*)?$/.test(lines[start])) start++;
  const body = lines.slice(start).join('\n');
  return { header: lines.slice(0, start).join('\n'), value: body.trim() === '' ? {} : JSON.parse(body) };
}

const list = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};
const parseVersion = (text) => /^(\d+)\.(\d+)\.(\d+)/.exec(text ?? '')?.slice(1).map(Number) ?? [0, 0, 0];
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** A plugin directory is ours when its manifest says so and it has been built. */
function candidate(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = path.join(dir, 'dist', 'index.js');
    if (manifest.name !== PLUGIN || !fs.existsSync(file)) return undefined;
    return { dir, file, version: manifest.version ?? '0.0.0' };
  } catch {
    return undefined;
  }
}

/** Find the installed plugin: Copilot's own registry first, then the install tree. */
export function resolveHud(home = copilotHome()) {
  const dirs = [];
  try {
    const { value } = parseCopilotJson(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    for (const plugin of value.installedPlugins ?? value.installed_plugins ?? []) {
      if (plugin?.name === PLUGIN && plugin.enabled !== false && typeof plugin.cache_path === 'string') {
        dirs.push(plugin.cache_path);
      }
    }
  } catch {
    // No registry, or one we can't read — the install tree below still works.
  }

  try {
    const { value } = parseCopilotJson(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    for (const marketplace of Object.values(value.extraKnownMarketplaces ?? {})) {
      const source = marketplace?.source;
      if (source?.source === 'directory' && typeof source.path === 'string') {
        dirs.push(source.path);
      }
    }
  } catch {
    // Local marketplaces are optional; installed plugins above still work.
  }

  // installed-plugins/<marketplace>/copilot-hud, or installed-plugins/_direct/<name>
  const root = path.join(home, 'installed-plugins');
  for (const source of list(root)) {
    for (const name of list(path.join(root, source))) dirs.push(path.join(root, source, name));
  }

  let latest;
  for (const dir of new Set(dirs)) {
    const found = candidate(dir);
    // Strictly newer wins, so on a tie the registry's entry is kept.
    if (found && (!latest || compare(parseVersion(found.version), parseVersion(latest.version)) > 0)) {
      latest = found;
    }
  }
  return latest;
}

const isMain = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    const hud = resolveHud();
    // No install found: print nothing, so Copilot simply shows no status line.
    if (hud) await (await import(pathToFileURL(hud.file).href)).main();
  } catch {
    // A broken HUD must never put a stack trace under the prompt.
  }
}
