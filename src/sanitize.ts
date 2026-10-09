/**
 * Everything the HUD prints that it didn't author — a prompt, a tool target, an
 * agent description, a branch or directory name — reaches the terminal through
 * here first.
 *
 * Those strings are attacker-influenced in the ordinary course of things: a
 * cloned repo picks its own branch and file names, and a model can be talked
 * into running a command whose text is an escape sequence. Printed raw, an
 * escape can recolor or rewrite the status line, move the cursor, or set the
 * window title; a bidirectional override can make a path read as a different
 * one.
 */

// ESC-introduced sequences: CSI (colors, cursor movement), OSC (title,
// hyperlinks; ended by BEL or ST), and the two-character forms.
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;
// C0 and C1 controls and DEL. Tab and newline are included: a status line
// segment is one line.
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g;
// Bidirectional embeddings, overrides, isolates and marks.
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

export function sanitize(text: string, max = 200): string {
  const clean = text
    .replace(ESCAPES, '')
    .replace(CONTROLS, ' ')
    .replace(BIDI, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A bound, not a layout decision — width fitting does the real truncation.
  return clean.length > max ? clean.slice(0, max) : clean;
}
