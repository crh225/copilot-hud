import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export interface HudConfig {
  pathLevels: 0 | 1 | 2 | 3;
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    /** Append changed-file counts to the branch: `!3 +1 ✘2 ?4`. */
    showFileStats: boolean;
  };
  display: {
    showTools: boolean;
    showAgents: boolean;
    maxAgents: number;
    /**
     * How long (in seconds) a completed sub-agent stays visible after it
     * finishes. Running agents are always shown. `0` disables fading (legacy
     * behavior: keep completed agents until pushed out by `maxAgents`).
     */
    completedAgentFadeSec: number;
    showProjectName: boolean;
    showSessionName: boolean;
    showSessionDuration: boolean;
    showTokenBreakdown: boolean;
    showOutputSpeed: boolean;
    showPromptPreview: boolean;
    showLinesChanged: boolean;
    showEffort: boolean;
    showLastCall: boolean;
    showCacheBreakdown: boolean;
    rainbowPath: boolean;
    showRemote: boolean;
    /** Monthly entitlement bar. Needs the session extension installed. */
    showQuota: boolean;
    /** Append `4770/7500` to the quota bar alongside the percentage. */
    showQuotaCounts: boolean;
    /** Append days remaining until the entitlement resets. */
    showQuotaReset: boolean;
    /**
     * Flag the quota bar with `▲` when usage is on track to run out before the
     * entitlement resets — amber when it would end the month at 90% or more,
     * red when it would hit the limit first.
     */
    showQuotaPace: boolean;
    /**
     * Keep every HUD line within the terminal width, dropping the least
     * important segments rather than letting the line wrap. Disable to get the
     * previous behavior of always drawing everything.
     */
    fitWidth: boolean;
    /**
     * Column budget for `fitWidth`. `0` auto-detects the terminal width; set a
     * positive number to pin it (useful when the terminal can't be probed, or
     * when the HUD shares a split pane).
     */
    maxWidth: number;
  };
  colors: {
    project: string;
    git: string;
    gitBranch: string;
    tools: string;
    success: string;
    failure: string;
    label: string;
    header: string;
    rainbowPathBg: string;
  };
}

const COPILOT_HOME = process.env.COPILOT_HOME ?? join(homedir(), '.copilot');
const CONFIG_FILE = join(COPILOT_HOME, 'plugins', 'copilot-hud', 'config.json');
const COPILOT_SETTINGS_FILE = join(COPILOT_HOME, 'settings.json');

const DEFAULTS: HudConfig = {
  pathLevels: 1,
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: true,
    showFileStats: false,
  },
  display: {
    showTools: true,
    showAgents: true,
    maxAgents: 5,
    completedAgentFadeSec: 30,
    showProjectName: true,
    showSessionName: true,
    showSessionDuration: true,
    showTokenBreakdown: true,
    showOutputSpeed: true,
    showPromptPreview: false,
    showLinesChanged: true,
    showEffort: true,
    showLastCall: false,
    showCacheBreakdown: false,
    rainbowPath: false,
    showRemote: true,
    showQuota: true,
    showQuotaCounts: true,
    showQuotaReset: true,
    showQuotaPace: false,
    fitWidth: true,
    maxWidth: 0,
  },
  colors: {
    project: 'yellow',
    git: 'magenta',
    gitBranch: 'cyan',
    tools: 'green',
    success: 'green',
    failure: 'red',
    label: 'dim',
    header: 'cyan',
    rainbowPathBg: '189',
  },
};

export function loadConfig(): HudConfig {
  if (!existsSync(CONFIG_FILE)) {
    return DEFAULTS;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HudConfig>;
    return deepMerge(DEFAULTS, parsed);
  } catch {
    return DEFAULTS;
  }
}

export function loadConfiguredEffort(): string | undefined {
  if (!existsSync(COPILOT_SETTINGS_FILE)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(COPILOT_SETTINGS_FILE, 'utf8')) as {
      effortLevel?: unknown;
      reasoningEffort?: unknown;
    };
    const effort = parsed.effortLevel ?? parsed.reasoningEffort;
    return typeof effort === 'string' ? effort : undefined;
  } catch {
    return undefined;
  }
}

export function saveConfig(config: HudConfig): void {
  const dir = dirname(CONFIG_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (overrideVal !== undefined) {
      if (
        typeof overrideVal === 'object' &&
        !Array.isArray(overrideVal) &&
        overrideVal !== null &&
        typeof baseVal === 'object' &&
        !Array.isArray(baseVal) &&
        baseVal !== null
      ) {
        (result[key] as object) = deepMerge(baseVal as object, overrideVal as object);
      } else {
        result[key] = overrideVal as T[keyof T];
      }
    }
  }
  return result;
}
