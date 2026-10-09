export interface GitFileStats {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
}
export interface GitStatus {
    branch: string;
    dirty: boolean;
    ahead: number;
    behind: number;
    /** Absent when the status call didn't finish — only the branch is known. */
    fileStats?: GitFileStats;
}
/**
 * Parse `git status --porcelain=v2 --branch`. One call carries the branch, the
 * ahead/behind counts and every changed path, where the HUD used to spawn git
 * three times per render.
 */
export declare function parseStatus(output: string): GitStatus | null;
export declare function getGitStatus(cwd?: string): GitStatus | null;
