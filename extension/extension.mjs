/**
 * copilot-hud session extension — feeds the statusline data it cannot reach.
 *
 * The statusline contract is a JSON blob on stdin, and it carries no quota
 * fields. Neither does the on-disk event log: `assistant.usage` is declared
 * `ephemeral: true`, so the only place entitlement/usage/reset ever exists is
 * in-flight, on the live session. Attaching here is the only way to see it.
 *
 * Writes `$COPILOT_HOME/hud-quota.json` for `readQuota()` in src/state.ts.
 * Set COPILOT_HUD_PROBE=1 to also append raw events to hud-probe.jsonl.
 *
 * Deployed by `/copilot-hud:setup` to `$COPILOT_HOME/extensions/copilot-hud/`.
 * The CLI only discovers extensions in `<config>/extensions` and
 * `<gitRoot>/.github/extensions`, so it cannot be loaded from the plugin dir.
 */

import { joinSession } from '@github/copilot-sdk/extension';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const COPILOT_HOME = process.env.COPILOT_HOME ?? join(homedir(), '.copilot');
const QUOTA_FILE = join(COPILOT_HOME, 'hud-quota.json');
const USAGE_DB_FILE = join(COPILOT_HOME, 'hud-usage.sqlite');
const PROBE_FILE = join(COPILOT_HOME, 'hud-probe.jsonl');
const PROBE = process.env.COPILOT_HUD_PROBE === '1';

function probe(kind, data) {
  if (!PROBE) return;
  try {
    appendFileSync(PROBE_FILE, JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n');
  } catch {
    // A probe must never take the session down with it.
  }
}

/**
 * Normalise one `quotaSnapshots` entry.
 *
 * Two things the SDK's own type comments get wrong, confirmed against a live
 * session: `remainingPercentage` is 0–100, not "0.0 to 1.0", and unlimited
 * quotas report `entitlementRequests: -1` rather than a real ceiling. Derive
 * the used percentage from the raw counts so we never depend on either.
 */
function normalise(id, q) {
  const unlimited = q.isUnlimitedEntitlement || q.entitlementRequests < 0;
  const entitlement = q.entitlementRequests;
  const used = q.usedRequests ?? 0;

  return {
    id,
    unlimited,
    used,
    entitlement,
    usedPercentage: unlimited || !entitlement || entitlement <= 0
      ? 0
      : Math.min(100, (used / entitlement) * 100),
    resetDate: q.resetDate,
    overage: q.overage ?? 0,
  };
}

function writeQuota(snapshots) {
  // Observed keys: `chat`, `completions`, `premium_interactions`. Keep them all
  // — the renderer decides which to show — but the key set is undocumented, so
  // never hardcode a lookup.
  const quotas = Object.entries(snapshots).map(([id, q]) => normalise(id, q));
  const payload = { updatedAt: Date.now(), quotas };

  try {
    mkdirSync(COPILOT_HOME, { recursive: true });
    // Write-then-rename: the statusline reads this file on every render, and a
    // torn read would blank the bar mid-session.
    const tmp = `${QUOTA_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, QUOTA_FILE);
  } catch {
    // Statusline falls back to hiding the bar; never break the session.
  }
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * `totalNanoAiu` is cumulative for one session. Store the last observed total
 * for each session and add only its increase to this calendar month's shared
 * ledger, which lets every open HUD read the same aggregate.
 */
function recordUsage(sessionId, totalNanoAiu) {
  if (
    typeof sessionId !== 'string'
    || !Number.isSafeInteger(totalNanoAiu)
    || totalNanoAiu < 0
  ) {
    return;
  }

  let db;
  try {
    mkdirSync(COPILOT_HOME, { recursive: true });
    db = new DatabaseSync(USAGE_DB_FILE);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS session_usage (
        session_id TEXT PRIMARY KEY,
        total_nano_aiu INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monthly_usage (
        month TEXT PRIMARY KEY,
        total_nano_aiu INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare(
        'SELECT total_nano_aiu FROM session_usage WHERE session_id = ?',
      ).get(sessionId);
      const delta = Math.max(0, totalNanoAiu - (previous?.total_nano_aiu ?? 0));
      const month = currentMonth();

      db.prepare(`
        INSERT INTO monthly_usage (month, total_nano_aiu, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(month) DO UPDATE SET
          total_nano_aiu = total_nano_aiu + excluded.total_nano_aiu,
          updated_at = excluded.updated_at
      `).run(month, delta, Date.now());
      db.prepare(`
        INSERT INTO session_usage (session_id, total_nano_aiu)
        VALUES (?, ?)
        ON CONFLICT(session_id) DO UPDATE SET total_nano_aiu = excluded.total_nano_aiu
      `).run(sessionId, totalNanoAiu);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch {
    // Tracking must never disrupt Copilot if the local ledger is unavailable.
  } finally {
    db?.close();
  }
}

const session = await joinSession();

probe('probe.start', { pid: process.pid, cwd: process.cwd() });

session.on('assistant.usage', (event) => {
  const d = event.data ?? {};

  probe('assistant.usage', {
    model: d.model,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    cost: d.cost,
    duration: d.duration,
    reasoningEffort: d.reasoningEffort,
    // Becomes "sub-agent" for agent-initiated calls — this is what makes
    // per-agent cost attribution possible, which the statusline cannot do.
    initiator: d.initiator,
    parentToolCallId: d.parentToolCallId,
    totalNanoAiu: d.copilotUsage?.totalNanoAiu,
    quotaSnapshots: d.quotaSnapshots,
  });

  if (d.quotaSnapshots) {
    writeQuota(d.quotaSnapshots);
  }

  recordUsage(session.sessionId, d.copilotUsage?.totalNanoAiu);
});
