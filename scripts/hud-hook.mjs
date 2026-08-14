#!/usr/bin/env node
/**
 * copilot-hud hooks — every hook, in one place.
 *
 *   node hud-hook.mjs <session-start|user-prompt|pre-tool-use|post-tool-use|session-end>
 *
 * This replaces the jq pipelines the shell hooks used to run. jq was the only
 * thing in the project a user had to install separately; node is already
 * required, because the statusline renderer is a node program. The shell and
 * PowerShell hooks are now thin wrappers around this file, so the two platforms
 * share one implementation instead of two that drift apart.
 *
 * Hook payloads (verified against live stdin, not the session event log — the
 * event log records Copilot's *internal* shape, which is different and has
 * caused a regression before):
 *
 *   sessionStart         {sessionId, timestamp, cwd}
 *   userPromptSubmitted  {sessionId, timestamp, cwd, prompt}
 *   preToolUse           {sessionId, timestamp, cwd, toolName, toolArgs}
 *   postToolUse          {sessionId, timestamp, cwd, toolName, toolArgs, toolResult}
 *   sessionEnd           {sessionId, timestamp, cwd}
 *
 * `toolArgs` arrives as a JSON *string*, not an object.
 *
 * A hook must never take the session down with it: every failure path exits 0.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const COPILOT_HOME = process.env.COPILOT_HOME ?? join(homedir(), '.copilot');
const STATE_FILE = join(COPILOT_HOME, 'hud-state.json');
const LOCK_DIR = `${STATE_FILE}.lock`;

const MAX_RECENT_TOOLS = 8;
const LOCK_RETRIES = 40;
const LOCK_RETRY_MS = 50;

/** Copilot's own bookkeeping tools — noise on a status line. */
const INTERNAL_TOOLS = new Set(['report_intent', 'task_complete', 'thinking', 'list_agents', 'write_agent']);

// ---------------------------------------------------------------------------
// plumbing

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    // No stdin, or a TTY that would block — treat as an empty payload.
    return '';
  }
}

/** PowerShell can prepend a UTF-8 BOM when piping; JSON.parse chokes on it. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Synchronous sleep — hooks are short-lived, single-shot processes. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire the state lock. `mkdir` is atomic, and the directory form is kept
 * from the shell implementation so a lock left behind by an older version is
 * still understood.
 *
 * After ~2s we assume the holder died and take the lock anyway: a stuck lock
 * would freeze the HUD for the rest of the session, which is worse than the
 * torn update it protects against.
 */
function acquireLock() {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      mkdirSync(LOCK_DIR);
      return;
    } catch {
      sleep(LOCK_RETRY_MS);
    }
  }
  try {
    rmdirSync(LOCK_DIR);
  } catch {
    // Someone else cleared it; either way we proceed.
  }
}

function releaseLock() {
  try {
    rmdirSync(LOCK_DIR);
  } catch {
    // Already released.
  }
}

function readState() {
  return parseJson(readFileSync(STATE_FILE, 'utf8'), null);
}

/**
 * Write-then-rename. The statusline reads this file on every render, and a
 * torn read would blank the HUD mid-session. The pid in the temp name keeps
 * two hooks from clobbering each other's scratch file.
 */
function writeState(state) {
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, STATE_FILE);
}

/**
 * Read, mutate, write under the lock. `mutate` returning false abandons the
 * update, leaving the file untouched.
 */
function updateState(mutate) {
  if (!existsSync(STATE_FILE)) return;

  acquireLock();
  try {
    const state = readState();
    if (!state) return;
    if (mutate(state) === false) return;
    writeState(state);
  } finally {
    releaseLock();
  }
}

/**
 * Hook timestamps are epoch ms. The field has been present on every payload
 * observed, but a missing one would otherwise be stored as 0 and render as a
 * ~56-year duration, so fall back to now.
 */
function timestampOf(payload) {
  const ts = payload.timestamp;
  return typeof ts === 'number' && ts > 0 ? ts : Date.now();
}

/** `toolArgs` is a JSON string in practice; tolerate an object too. */
function parseToolArgs(payload) {
  const args = payload.toolArgs;
  if (args && typeof args === 'object') return args;
  if (typeof args === 'string') return parseJson(args, {});
  return {};
}

// ---------------------------------------------------------------------------
// hooks

function sessionStart(payload) {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';

  // Resuming the same session keeps its agents; a different session starts clean.
  let agents = [];
  if (existsSync(STATE_FILE)) {
    const previous = readState();
    if (previous && sessionId && previous.sessionId === sessionId && Array.isArray(previous.agents)) {
      agents = previous.agents;
    }
  }

  mkdirSync(COPILOT_HOME, { recursive: true });
  writeState({
    sessionId,
    sessionStart: timestampOf(payload),
    cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
    lastPrompt: null,
    lastPromptTime: null,
    recentTools: [],
    agents,
    sessionActive: true,
  });
}

function userPrompt(payload) {
  updateState((state) => {
    state.lastPrompt = typeof payload.prompt === 'string' ? payload.prompt : '';
    state.lastPromptTime = timestampOf(payload);
  });
}

/** A readable label for what a tool is acting on. */
function targetFor(toolName, args) {
  if (toolName === 'edit' || toolName === 'view' || toolName === 'create') {
    const path = args.path ?? args.file_path;
    return typeof path === 'string' ? path : '';
  }

  if (toolName === 'bash') {
    const command = typeof args.command === 'string' ? args.command : '';
    // Copilot prepends `cd <path> && ` to shell commands; it's the same for
    // every call and crowds out the part worth reading.
    return command.split('\n')[0].replace(/^cd [^ ]* && /, '').slice(0, 60);
  }

  return '';
}

function preToolUse(payload) {
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : '';
  if (!toolName) return;
  // read_agent is skipped here but not in postToolUse: its *completion* is how
  // we learn a sub-agent finished.
  if (INTERNAL_TOOLS.has(toolName) || toolName === 'read_agent') return;

  const args = parseToolArgs(payload);
  const timestamp = timestampOf(payload);

  // A `task` call is a sub-agent spawn, tracked on its own line rather than as
  // a tool. postToolUse deliberately ignores `task`, so this is the only place
  // a running agent is ever recorded.
  if (toolName === 'task') {
    const description = typeof args.description === 'string' ? args.description : '';
    if (!description) return;
    const subagentType = typeof args.agent_type === 'string' && args.agent_type ? args.agent_type : null;

    updateState((state) => {
      if (!Array.isArray(state.agents)) state.agents = [];
      state.agents.push({ description, subagentType, status: 'running', startTime: timestamp });
    });
    return;
  }

  const target = targetFor(toolName, args);
  updateState((state) => {
    if (!Array.isArray(state.recentTools)) state.recentTools = [];
    state.recentTools.unshift({ name: toolName, target: target || null, status: 'running', timestamp });
    state.recentTools = state.recentTools.slice(0, MAX_RECENT_TOOLS);
  });
}

function postToolUse(payload) {
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : '';
  if (!toolName) return;
  if (INTERNAL_TOOLS.has(toolName)) return;
  // A `task` completion means the agent was *spawned*, not that it finished.
  if (toolName === 'task') return;

  const resultType = payload.toolResult?.resultType;
  const status = resultType === 'failure' || resultType === 'denied' ? resultType : 'success';
  const timestamp = timestampOf(payload);

  // read_agent completing is the signal that a sub-agent has finished. Agents
  // are appended, so the oldest running one is the one being collected.
  if (toolName === 'read_agent') {
    updateState((state) => {
      const agents = Array.isArray(state.agents) ? state.agents : [];
      const agent = agents.find((a) => a.status === 'running');
      if (!agent) return false;
      agent.status = status;
      agent.endTime = timestamp;
    });
    return;
  }

  updateState((state) => {
    if (!Array.isArray(state.recentTools)) state.recentTools = [];
    // recentTools is newest-first, so the first match is the call that just
    // finished. Without a running entry — a hook that never fired, or a tool
    // started before the HUD did — record the completion on its own.
    const running = state.recentTools.find((t) => t.name === toolName && t.status === 'running');
    if (running) {
      running.status = status;
      running.timestamp = timestamp;
      return;
    }
    state.recentTools.unshift({ name: toolName, status, timestamp });
    state.recentTools = state.recentTools.slice(0, MAX_RECENT_TOOLS);
  });
}

function sessionEnd() {
  updateState((state) => {
    state.sessionActive = false;
  });
}

// ---------------------------------------------------------------------------

const HOOKS = {
  'session-start': sessionStart,
  'user-prompt': userPrompt,
  'pre-tool-use': preToolUse,
  'post-tool-use': postToolUse,
  'session-end': sessionEnd,
};

function main() {
  const hook = HOOKS[process.argv[2]];
  if (!hook) return;

  // Unparseable stdin is not the same as an empty payload. Falling back to `{}`
  // would let `user-prompt` overwrite a real prompt with a blank one, so a
  // payload we can't read means we do nothing at all.
  const payload = parseJson(stripBom(readStdin()), null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  hook(payload);
}

try {
  main();
} catch {
  // Never fail a hook: a broken HUD update must not disturb the session.
}
process.exit(0);
