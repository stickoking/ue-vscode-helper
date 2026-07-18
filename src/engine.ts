import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileExists, readJson, normalizeSlashes } from './util';
import { getHelperSetting } from './host';

const EPIC_GAMES_ROOT = 'C:\\Program Files\\Epic Games';

export interface ProjectInfo {
    projectPath: string;
    projectName: string;
    uprojectPath: string;
    enginePath: string;
}

const LAST_UPROJECT_STATE_KEY = 'ue-vscode-helper.lastUprojectPath';

/**
 * Resolve which `.uproject` to set up.
 * Never use findFiles(..., 1) or a silent maxResults cap.
 * Prefer: remembered path (if still present) → sole match → active-editor ancestry → QuickPick.
 * When multiple exist, never auto-pick a sole workspace-folder-root `.uproject` while nested
 * games also exist — that was Bugbot "Auto-picks wrong uproject".
 */
export type UprojectResolveResult =
    | { status: 'found'; uprojectPath: string }
    | { status: 'none' }
    | { status: 'cancelled' };

/** Distinct cancel vs none — never collapse both to undefined (Git init false "No .uproject"). */
export type FindProjectResult =
    | { status: 'found'; info: ProjectInfo }
    | { status: 'none' }
    | { status: 'cancelled' };

export async function rememberUprojectPath(
    context: vscode.ExtensionContext,
    uprojectPath: string
): Promise<void> {
    await context.workspaceState.update(LAST_UPROJECT_STATE_KEY, uprojectPath);
}

export function getRememberedUprojectPath(
    context: vscode.ExtensionContext
): string | undefined {
    const value = context.workspaceState.get<string>(LAST_UPROJECT_STATE_KEY);
    return value && value.trim() ? value : undefined;
}

export async function resolveUprojectPath(
    preferredPath?: string
): Promise<UprojectResolveResult> {
    const uprojectFiles = await vscode.workspace.findFiles(
        '**/*.uproject',
        '**/{node_modules,Binaries,DerivedDataCache,Intermediate,Saved}/**'
    );
    if (uprojectFiles.length === 0) {
        return { status: 'none' };
    }
    if (uprojectFiles.length === 1) {
        return { status: 'found', uprojectPath: uprojectFiles[0].fsPath };
    }

    const paths = uprojectFiles.map((u) => u.fsPath);
    const byNorm = new Map(paths.map((p) => [path.normalize(p).toLowerCase(), p]));

    // 1) Active editor under a game root (deepest) — user is looking at that project.
    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (activePath) {
        const containing = paths
            .filter((uprojectPath) => {
                const root = path.dirname(uprojectPath);
                const rel = path.relative(root, activePath);
                return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
            })
            .sort((a, b) => path.dirname(b).length - path.dirname(a).length);
        if (containing.length > 0) {
            return { status: 'found', uprojectPath: containing[0] };
        }
    }

    // 2) Remembered path from prior Setup/Git confirm — only when no editor hint.
    if (preferredPath) {
        const hit = byNorm.get(path.normalize(preferredPath).toLowerCase());
        if (hit) {
            return { status: 'found', uprojectPath: hit };
        }
    }

    // 3) QuickPick every discovered .uproject (never folder-root-only).
    const picked = await vscode.window.showQuickPick(
        paths.map((uprojectPath) => ({
            label: path.basename(uprojectPath, '.uproject'),
            description: path.dirname(uprojectPath),
            uprojectPath,
        })),
        {
            placeHolder: 'Multiple .uproject files found — choose which project to set up',
            ignoreFocusOut: true,
        }
    );
    if (!picked) {
        return { status: 'cancelled' };
    }
    return { status: 'found', uprojectPath: picked.uprojectPath };
}

/**
 * @param uprojectPath Explicit path skips resolve (Setup already chose).
 * @param preferredPath Remembered path when resolving (Git init after Setup).
 * @param options.resolveEngine When false (Git init), skip engine/helper settings —
 *   Git only needs projectPath/uprojectPath so invalid settings JSONC cannot block init.
 */
export async function findProjectInfo(
    uprojectPath?: string,
    preferredPath?: string,
    options?: { resolveEngine?: boolean }
): Promise<FindProjectResult> {
    if (!vscode.workspace.workspaceFolders?.length) {
        return { status: 'none' };
    }

    let resolvedPath = uprojectPath;
    if (!resolvedPath) {
        const resolved = await resolveUprojectPath(preferredPath);
        if (resolved.status === 'cancelled') {
            return { status: 'cancelled' };
        }
        if (resolved.status === 'none') {
            return { status: 'none' };
        }
        resolvedPath = resolved.uprojectPath;
    }

    const projectPath = path.dirname(resolvedPath);
    const projectName = path.basename(resolvedPath, '.uproject');
    const enginePath =
        options?.resolveEngine === false ? '' : await resolveEnginePath(resolvedPath);

    return {
        status: 'found',
        info: { projectPath, projectName, uprojectPath: resolvedPath, enginePath },
    };
}

/**
 * Prefer EngineAssociation from .uproject → Epic Games/UE_X.Y,
 * then fall back to ue-vscode-helper.enginePath setting.
 */
export async function resolveEnginePath(uprojectPath: string): Promise<string> {
    // Prefer this game's .vscode/settings.json (not first multi-root folder via getConfiguration).
    const projectPath = path.dirname(uprojectPath);
    const configured = (
        (await getHelperSetting<string>(
            projectPath,
            'enginePath',
            `${EPIC_GAMES_ROOT}\\UE_5.4`
        )) || `${EPIC_GAMES_ROOT}\\UE_5.4`
    ).replace(/\\+$/, '');

    try {
        const uproject = await readJson<{ EngineAssociation?: string }>(uprojectPath);
        const association = uproject.EngineAssociation?.trim();
        if (association) {
            const candidate = await resolveFromAssociation(association);
            if (candidate) {
                return candidate.replace(/\\+$/, '');
            }
        }
    } catch {
        // fall through to configured path
    }

    return configured;
}

async function resolveFromAssociation(association: string): Promise<string | undefined> {
    // GUID associations (source builds / launcher custom) — can't map reliably
    if (/^[0-9a-f-]{36}$/i.test(association)) {
        return undefined;
    }

    // "5.8" or "UE_5.8"
    const versionMatch = association.match(/^(?:UE[_-]?)?(\d+\.\d+)/i);
    if (!versionMatch) {
        return undefined;
    }

    const version = versionMatch[1];
    const candidates = [
        path.join(EPIC_GAMES_ROOT, `UE_${version}`),
        path.join(EPIC_GAMES_ROOT, `UE${version}`),
    ];

    for (const candidate of candidates) {
        if (await fileExists(path.join(candidate, 'Engine'))) {
            return candidate;
        }
    }

    return undefined;
}

/**
 * Compare DotNet version folder names numerically (semver-like).
 * Lexicographic sort puts "10.0" before "9.0"; this puts 10.0 after 9.0.
 */
export function compareDotNetVersionFolders(a: string, b: string): number {
    const pa = a.split('.').map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
    const pb = b.split('.').map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da !== db) {
            return da - db;
        }
    }
    return 0;
}

/** Detect UE-bundled DotNet folder (version folder may differ across engines). */
export async function findUeDotNetPath(enginePath: string): Promise<string | undefined> {
    const dotNetRoot = path.join(enginePath, 'Engine', 'Binaries', 'ThirdParty', 'DotNet');
    if (!(await fileExists(dotNetRoot))) {
        return undefined;
    }

    // Prefer win-x64 under the highest version folder (e.g. 10.0/win-x64 over 9.0)
    try {
        const entries = await fs.readdir(dotNetRoot, { withFileTypes: true });
        const versionDirs = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort(compareDotNetVersionFolders)
            .reverse(); // highest first

        for (const ver of versionDirs) {
            const winX64 = path.join(dotNetRoot, ver, 'win-x64');
            if (await fileExists(path.join(winX64, 'dotnet.exe'))) {
                return normalizeSlashes(winX64);
            }
        }
    } catch {
        return undefined;
    }

    return undefined;
}

export function moduleRulesCsproj(projectPath: string, projectName: string): string {
    return path.join(
        projectPath,
        'Intermediate',
        'Build',
        'BuildRulesProjects',
        `${projectName}ModuleRules`,
        `${projectName}ModuleRules.csproj`
    );
}

export function moduleRulesRelative(projectName: string): string {
    return `Intermediate/Build/BuildRulesProjects/${projectName}ModuleRules/${projectName}ModuleRules.csproj`;
}

/** Slim IntelliSense-only csproj under `.vscode/` (no UE5Rules). */
export function buildRulesIntelliSenseCsproj(projectPath: string, projectName: string): string {
    return path.join(projectPath, '.vscode', `${projectName}.BuildRules.IntelliSense.csproj`);
}

export function buildRulesIntelliSenseRelative(projectName: string): string {
    return `.vscode/${projectName}.BuildRules.IntelliSense.csproj`;
}

/** Slim IntelliSense-only .sln under `.vscode/` — C# LS prefers .sln over .csproj. */
export function buildRulesIntelliSenseSln(projectPath: string, projectName: string): string {
    return path.join(projectPath, '.vscode', `${projectName}.BuildRules.IntelliSense.sln`);
}

/**
 * Relative path for `dotnet.defaultSolution`.
 * Must be a .sln: anysphere.csharp / C# Dev Kit auto-load root `*.sln` (ModuleRules→UE5Rules)
 * when this points at a .csproj or is missing.
 */
export function buildRulesIntelliSenseSlnRelative(projectName: string): string {
    return `.vscode/${projectName}.BuildRules.IntelliSense.sln`;
}

export function unrealEngineCsprojProps(enginePath: string): string {
    return path.join(enginePath, 'Engine', 'Source', 'Programs', 'Shared', 'UnrealEngine.csproj.props');
}

export function unrealBuildToolCsproj(enginePath: string): string {
    return path.join(enginePath, 'Engine', 'Source', 'Programs', 'UnrealBuildTool', 'UnrealBuildTool.csproj');
}

export function epicGamesBuildCsproj(enginePath: string): string {
    return path.join(enginePath, 'Engine', 'Source', 'Programs', 'Shared', 'EpicGames.Build', 'EpicGames.Build.csproj');
}
