import { getVersion } from "@tauri-apps/api/app";

export interface BuildInfo {
    version: string;
    distribution: "github" | "microsoft-store" | "portable" | "unknown";
    isSigned: boolean;
    isPortable: boolean;
    canAutoUpdate: boolean;
    githubRepo: string;
}


const DEFAULT_GITHUB_REPO = "drrakendu78/TradSC";

export function detectDistribution(): BuildInfo["distribution"] {
    // Injecté via vite.config.ts define
    if (process.env.TAURI_ENV_MS_STORE === "true") {
        return "microsoft-store";
    }

    if (process.env.TAURI_ENV_DISTRIBUTION === "github") {
        return "github";
    }

    if (process.env.TAURI_ENV_PORTABLE === "true") {
        return "portable";
    }

    try {
        if (
            typeof window !== "undefined" &&
            window.location &&
            window.location.href.includes("WindowsApps")
        ) {
            return "microsoft-store";
        }

        if (
            typeof localStorage !== "undefined" &&
            localStorage.getItem("PORTABLE_MODE") === "true"
        ) {
            return "github";
        }

        return "github";
    } catch (error) {
        return "unknown";
    }
}

function isBuildSigned(
    distribution: BuildInfo["distribution"]
): boolean {
    return distribution === "microsoft-store";
}

function isPortableBuild(): boolean {
    return process.env.TAURI_ENV_PORTABLE === "true";
}

function canAutoUpdate(
    distribution: BuildInfo["distribution"]
): boolean {
    return distribution === "github";
}


export async function getBuildInfo(
    githubRepo: string = DEFAULT_GITHUB_REPO
): Promise<BuildInfo> {
    const distribution = detectDistribution();
    const version = await getVersion();

    return {
        version,
        distribution,
        isSigned: isBuildSigned(distribution),
        isPortable: isPortableBuild(),
        canAutoUpdate: canAutoUpdate(distribution),
        githubRepo,
    };
}


export async function shouldShowSecurityWarning(): Promise<boolean> {
    const hasSeenWarning =
        localStorage.getItem("security-warning-seen") === "true";
    if (hasSeenWarning) return false;

    const buildInfo = await getBuildInfo();
    return !buildInfo.isSigned;
}

