---
description: Configure which elements appear in the Copilot HUD
allowed-tools: Bash, Read, Edit
---

# Configure Copilot HUD

## Read the current config

The config file is `plugins/copilot-hud/config.json` inside the Copilot home (`$COPILOT_HOME` when set, otherwise `~/.copilot`). This command writes only that file.

```bash
cat "${COPILOT_HOME:-$HOME/.copilot}/plugins/copilot-hud/config.json" 2>/dev/null || echo "(no config — using defaults)"
```

Missing keys use the defaults in `docs/CONFIGURATION.md`. The effective config is the file layered over those defaults; use the effective values when describing the current state.

## Ask

Ask the user these questions, in two batches of four. Put the current value in each question. In multi-select questions, every listed item becomes `true` if selected and `false` if not. Every single-select question also offers "Keep current", which changes none of its keys.

### Batch 1

**Detail** (single select) — how much the two info lines show. Model, context bar, and credits are always shown.

| Option | Keys (all under `display`) |
|---|---|
| Full — everything, plus last call and cache read/write | `showSessionName`, `showSessionDuration`, `showTokenBreakdown`, `showOutputSpeed`, `showLinesChanged`, `showEffort`, `showLastCall`, `showCacheBreakdown`: all `true` |
| Standard (default) — session name, duration, tokens, speed, lines changed, effort | the first six `true`; `showLastCall`, `showCacheBreakdown`: `false` |
| Minimal — model, project, context bar, credits | all eight `false` |

**Activity lines** (multi-select)

- "Tools — `✓ Edit: auth.ts | ✓ Bash: git status ×3`": `display.showTools`
- "Agents — `✓ [explore] Search codebase (12s)`": `display.showAgents`
- "Prompt — `❯ fix the auth redirect loop (42s)`": `display.showPromptPreview`

**Git** (single select)

| Option | `gitStatus` keys |
|---|---|
| Branch + dirty + ahead/behind (default) — `git:(main* ↑2 ↓1)` | `enabled: true`, `showDirty: true`, `showAheadBehind: true` |
| Branch + dirty — `git:(main*)` | `enabled: true`, `showDirty: true`, `showAheadBehind: false` |
| Branch only — `git:(main)` | `enabled: true`, `showDirty: false`, `showAheadBehind: false` |
| Disabled | `enabled: false` |

**Quota bar** (single select) — monthly entitlement usage. It needs the session extension that `/copilot-hud:setup` installs; without it this setting has no visible effect.

| Option | Keys (all under `display`) |
|---|---|
| Full (default) — `Quota ██████░░░░ 4785/7500 64% · 19d` | `showQuota: true`, `showQuotaCounts: true`, `showQuotaReset: true` |
| Bar + counts — `Quota ██████░░░░ 4785/7500 64%` | `showQuota: true`, `showQuotaCounts: true`, `showQuotaReset: false` |
| Compact — `Quota ██████░░░░ 64%` | `showQuota: true`, `showQuotaCounts: false`, `showQuotaReset: false` |
| Hidden | `showQuota: false` |

### Batch 2

**Project path** (single select)

| Option | Keys |
|---|---|
| 1 level (default) — `my-project` | `pathLevels: 1`, `display.showProjectName: true` |
| 2 levels — `projects/my-project` | `pathLevels: 2`, `display.showProjectName: true` |
| 3 levels — `you/projects/my-project` | `pathLevels: 3`, `display.showProjectName: true` |
| Full path — `/Users/you/projects/my-project` | `pathLevels: 0`, `display.showProjectName: true` |
| Hidden | `display.showProjectName: false` |

**Path style** (single select)

| Option | Keys |
|---|---|
| Solid color (default) | `display.rainbowPath: false` |
| Rainbow + lavender background | `display.rainbowPath: true`, `colors.rainbowPathBg: "189"` |
| Rainbow, no background | `display.rainbowPath: true`, `colors.rainbowPathBg: "none"` |

**Extras** (multi-select)

- "Git file counts — `git:(main* !3 +1 ✘2 ?4)`": `gitStatus.showFileStats`
- "Quota pace — flag the quota bar with `▲` when you're on track to run out before it resets": `display.showQuotaPace`
- "Remote indicator — `◉ remote` when someone is attached to the session": `display.showRemote`

**Narrow terminals** (single select)

| Option | Keys (all under `display`) |
|---|---|
| Fit automatically (default) — drop the least important segments, then truncate | `fitWidth: true`, `maxWidth: 0` |
| Fit to a fixed width — ask for the column count | `fitWidth: true`, `maxWidth: <columns>` |
| Never truncate — draw everything and let the terminal wrap | `fitWidth: false` |

If the user cancels any question, say "Configuration cancelled." and stop.

## Preview and confirm

Compute the changed keys by comparing against the effective config.

- If nothing changed, say "No changes needed - config unchanged." and stop.
- Otherwise show each changed key as `key: old → new`, and a mock-up of the HUD with the new settings.

Then ask "Save these changes?"

## Write

Write the config file, creating directories as needed. Start from the existing file and change only the selected keys. Keep every other key exactly as it was, including settings this command doesn't ask about, such as `colors`, `display.maxAgents`, and `display.completedAgentFadeSec`. Write valid JSON with 2-space indentation.

Then say: "Configuration saved! The HUD picks it up on its next refresh." Mention that `docs/CONFIGURATION.md` documents every other option, and that they can also just ask — for example "hide the tool activity line" or "show two path levels".
