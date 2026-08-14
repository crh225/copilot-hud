export interface HudConfig {
    pathLevels: 0 | 1 | 2 | 3;
    gitStatus: {
        enabled: boolean;
        showDirty: boolean;
        showAheadBehind: boolean;
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
export declare function loadConfig(): HudConfig;
export declare function loadConfiguredEffort(): string | undefined;
export declare function saveConfig(config: HudConfig): void;
