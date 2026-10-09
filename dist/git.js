import { execFileSync } from 'node:child_process';
function git(cwd, args, timeout) {
    // --no-optional-locks: the HUD runs on every refresh and can be killed
    // mid-call; a status that refreshed the index would leave `.git/index.lock`
    // behind and block the user's own git commands.
    return execFileSync('git', ['--no-optional-locks', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout,
    });
}
/**
 * Parse `git status --porcelain=v2 --branch`. One call carries the branch, the
 * ahead/behind counts and every changed path, where the HUD used to spawn git
 * three times per render.
 */
export function parseStatus(output) {
    let branch = '';
    let ahead = 0;
    let behind = 0;
    const fileStats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
    for (const line of output.split('\n')) {
        if (line.startsWith('# branch.head ')) {
            branch = line.slice('# branch.head '.length).trim();
        }
        else if (line.startsWith('# branch.ab ')) {
            // "# branch.ab +2 -1" — only present when there is an upstream.
            const match = /\+(\d+) -(\d+)/.exec(line);
            if (match) {
                ahead = parseInt(match[1], 10);
                behind = parseInt(match[2], 10);
            }
        }
        else if (line.startsWith('1 ') || line.startsWith('2 ')) {
            // Ordinary and renamed entries: "<1|2> <XY> ...", X staged, Y unstaged.
            const xy = line.slice(2, 4);
            if (xy.includes('D'))
                fileStats.deleted += 1;
            else if (xy.includes('A'))
                fileStats.added += 1;
            else
                fileStats.modified += 1;
        }
        else if (line.startsWith('u ')) {
            // Unmerged: a conflict is a modification until it is resolved.
            fileStats.modified += 1;
        }
        else if (line.startsWith('? ')) {
            fileStats.untracked += 1;
        }
    }
    // A detached HEAD has no branch name to show.
    if (!branch || branch === '(detached)')
        return null;
    const { modified, added, deleted, untracked } = fileStats;
    return { branch, dirty: modified + added + deleted + untracked > 0, ahead, behind, fileStats };
}
export function getGitStatus(cwd) {
    const dir = cwd ?? process.cwd();
    try {
        return parseStatus(git(dir, ['status', '--porcelain=v2', '--branch'], 2000));
    }
    catch {
        // Not a repo, or `git status` was too slow — on very large repos it can
        // take several seconds. A slow status must NOT drop the branch from the
        // HUD, so fall back to the one call that is effectively instant and simply
        // omit the dirty marker and counts.
    }
    try {
        const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], 3000).trim();
        if (!branch || branch === 'HEAD')
            return null;
        return { branch, dirty: false, ahead: 0, behind: 0 };
    }
    catch {
        return null;
    }
}
