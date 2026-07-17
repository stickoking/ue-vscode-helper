import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileExists, readJson, normalizeSlashes } from './util';

const EPIC_GAMES_ROOT = 'C:\\Program Files\\Epic Games';

export interface ProjectInfo {
    projectPath: string;
    projectName: string;
    uprojectPath: string;
    enginePath: string;
}

export async function findProjectInfo(): Promise<ProjectInfo | undefined> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        return undefined;
    }

    const projectPath = workspace.uri.fsPath;
    const uprojectFiles = await vscode.workspace.findFiles('**/*.uproject', '**/node_modules/**', 1);
    if (uprojectFiles.length === 0) {
        return undefined;
    }

    const uprojectPath = uprojectFiles[0].fsPath;
    const projectName = path.basename(uprojectPath, '.uproject');
    const enginePath = await resolveEnginePath(uprojectPath);

    return { projectPath, projectName, uprojectPath, enginePath };
}

/**
 * Prefer EngineAssociation from .uproject → Epic Games/UE_X.Y,
 * then fall back to ue-vscode-helper.enginePath setting.
 */
export async function resolveEnginePath(uprojectPath: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('ue-vscode-helper');
    const configured = (config.get<string>('enginePath') || `${EPIC_GAMES_ROOT}\\UE_5.4`).replace(/\\+$/, '');

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

/** Detect UE-bundled DotNet folder (version folder may differ across engines). */
export async function findUeDotNetPath(enginePath: string): Promise<string | undefined> {
    const dotNetRoot = path.join(enginePath, 'Engine', 'Binaries', 'ThirdParty', 'DotNet');
    if (!(await fileExists(dotNetRoot))) {
        return undefined;
    }

    // Prefer win-x64 under any version folder (e.g. 10.0/win-x64)
    try {
        const entries = await fs.readdir(dotNetRoot, { withFileTypes: true });
        const versionDirs = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort()
            .reverse(); // newest first

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
