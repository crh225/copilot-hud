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
export declare function sanitize(text: string, max?: number): string;
