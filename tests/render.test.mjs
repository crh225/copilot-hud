// Unit tests for the pieces of the renderer that parse or clean outside input.
// They import the build, so run them through `npm test`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseStatus } from '../dist/git.js';
import { sanitize } from '../dist/sanitize.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('sanitize strips escapes, controls and bidi overrides', () => {
  assert.equal(sanitize('a\x1b[31mb\x1b[0mc'), 'abc');
  assert.equal(sanitize('x\x1b]0;title\x07y'), 'xy');
  assert.equal(sanitize('x\x1b]8;;http://e.test\x1b\\link\x1b]8;;\x1b\\y'), 'xlinky');
  assert.equal(sanitize('one\ntwo\tthree\x00four'), 'one two three four');
  assert.equal(sanitize('safe‮gpj.exe'), 'safegpj.exe');
  assert.equal(sanitize('  spaced   out  '), 'spaced out');
  assert.equal(sanitize('abcdef', 3), 'abc');
});

test('sanitize leaves ordinary text alone', () => {
  assert.equal(sanitize('fix the auth redirect — 修复 ✓'), 'fix the auth redirect — 修复 ✓');
});

test('parseStatus reads branch, ahead/behind and file counts from one call', () => {
  const status = parseStatus([
    '# branch.oid 1234',
    '# branch.head feat/x',
    '# branch.upstream origin/feat/x',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b src/a.ts',
    '1 M. N... 100644 100644 100644 a b src/b.ts',
    '1 A. N... 000000 100644 100644 a b src/new.ts',
    '1 .D N... 100644 100644 000000 a b src/gone.ts',
    '2 R. N... 100644 100644 100644 a b R100 src/to.ts\tsrc/from.ts',
    'u UU N... 100644 100644 100644 100644 a b c src/conflict.ts',
    '? notes.txt',
    '? scratch/',
    '',
  ].join('\n'));
  assert.deepEqual(status, {
    branch: 'feat/x',
    dirty: true,
    ahead: 2,
    behind: 1,
    fileStats: { modified: 4, added: 1, deleted: 1, untracked: 2 },
  });
});

test('parseStatus: clean tree, no upstream', () => {
  const status = parseStatus('# branch.oid 1234\n# branch.head main\n');
  assert.equal(status.dirty, false);
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);
});

test('parseStatus: a detached HEAD has no branch to show', () => {
  assert.equal(parseStatus('# branch.oid 1234\n# branch.head (detached)\n'), null);
});

test('session-start refreshes a stale installed extension, and only an installed one', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-hud-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const installed = path.join(home, 'extensions', 'copilot-hud', 'extension.mjs');
  const hook = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'hud-hook.mjs'), 'session-start'], {
    env: { ...process.env, COPILOT_HOME: home },
    input: JSON.stringify({ sessionId: 's1', timestamp: Date.now(), cwd: home }),
  });

  // Not installed: the user opted out of the quota bar, so nothing appears.
  assert.equal(hook().status, 0);
  assert.ok(!fs.existsSync(installed));

  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.writeFileSync(installed, '// an older release\n');
  assert.equal(hook().status, 0);
  assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(ROOT, 'extension', 'extension.mjs')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'hud-state.json'), 'utf8')).sessionId, 's1');
});
