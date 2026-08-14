#!/bin/bash
# Copilot HUD: session-start hook
# Called when a new Copilot CLI session begins
#
# A thin wrapper. The implementation is in hud-hook.mjs, shared with the
# PowerShell hooks so the two platforms can't drift apart — see that file for
# the payload shapes, the state format, and the locking rules.
#
# NOTE: do not gate on `[ -t 1 ]` here. Copilot forks hooks with piped stdio
# so it can capture their output, which means stdin, stdout and stderr are ALL
# pipes even in a fully interactive session — the test can never be true, and
# gating on it silently disables every hook. Cross-session bleed is already
# prevented in render.ts, which only draws state whose sessionId matches the
# session currently being rendered.

# node also renders the statusline, so if it's missing there is no HUD to update.
command -v node >/dev/null 2>&1 || exit 0

exec node "$(dirname "$0")/hud-hook.mjs" session-start
