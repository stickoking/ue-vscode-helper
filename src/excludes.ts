import * as path from 'path';
import * as fs from 'fs/promises';
import { fileExists, readJson, writeJson, mergeSettings, normalizeSlashes } from './util';

export interface ExcludeMaps {
    watcherExclude: Record<string, boolean>;
    filesExclude: Record<string, boolean>;
    cppExclude: Record<string, boolean>;
    searchExclude: Record<string, boolean>;
}

/** Workspace setting keys whose values are exclude path→bool maps. */
export const EXCLUDE_SETTING_KEYS = [
    'files.watcherExclude',
    'files.exclude',
    'C_Cpp.files.exclude',
    'search.exclude',
] as const;

/**
 * Absolute path exclude keys (engine trees under Epic Games / drive letters).
 * Relative globs (e.g. star-star/Binaries/star-star) are preserved across Setup.
 */
export function isAbsoluteExcludeKey(key: string): boolean {
    // Normalize so stale `C:\...` keys (pre-normalizeSlashes / manual edits) are
    // treated as absolute and stripped when enginePath changes.
    const n = key.replace(/\\/g, '/');
    return /^[A-Za-z]:\//.test(n) || (n.startsWith('/') && !n.startsWith('**/'));
}

/**
 * Merge one exclude map: drop stale absolute engine-path keys from existing,
 * keep relative/user globs, then apply the incoming map (current engine).
 */
export function mergeExcludeMap(
    existing: Record<string, boolean> | undefined,
    incoming: Record<string, boolean>
): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        for (const [k, v] of Object.entries(existing)) {
            if (!isAbsoluteExcludeKey(k)) {
                result[k] = v;
            }
        }
    }
    Object.assign(result, incoming);
    return result;
}

/**
 * mergeSettings, then re-merge exclude maps so a changed enginePath does not
 * leave watchers/search pointed at the previous UE install.
 */
export function mergeSettingsWithExcludes(
    target: Record<string, any>,
    source: Record<string, any>
): Record<string, any> {
    const merged = mergeSettings(target, source);
    for (const key of EXCLUDE_SETTING_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            continue;
        }
        const incoming = source[key];
        if (incoming === undefined) {
            delete merged[key];
            continue;
        }
        if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
            merged[key] = mergeExcludeMap(target[key], incoming);
        }
    }
    return merged;
}

export function buildExcludeMaps(enginePath: string): ExcludeMaps {
    const engineNormalized = normalizeSlashes(enginePath);

    const watcherExclude: Record<string, boolean> = {
        '**/.git/objects/**': true,
        '**/node_modules/**': true,
        '**/Binaries/**': true,
        '**/DerivedDataCache/**': true,
        '**/Intermediate/**': true,
        '**/Saved/**': true,
        '**/Build/**': true,
        '**/.cache/**': true,
    };
    watcherExclude[`${engineNormalized}/Engine/Binaries/**`] = true;
    watcherExclude[`${engineNormalized}/Engine/Content/**`] = true;
    watcherExclude[`${engineNormalized}/Engine/DerivedDataCache/**`] = true;
    watcherExclude[`${engineNormalized}/Engine/Intermediate/**`] = true;
    watcherExclude[`${engineNormalized}/Engine/Saved/**`] = true;
    watcherExclude[`${engineNormalized}/Engine/Plugins/**/Binaries/**`] = true;
    watcherExclude[`${engineNormalized}/Engine/Plugins/**/Intermediate/**`] = true;
    watcherExclude[`${engineNormalized}/FeaturePacks/**`] = true;
    watcherExclude[`${engineNormalized}/Templates/**`] = true;

    const filesExclude: Record<string, boolean> = {};
    filesExclude[`${engineNormalized}/Engine/Binaries`] = true;
    filesExclude[`${engineNormalized}/Engine/Content`] = true;
    filesExclude[`${engineNormalized}/Engine/DerivedDataCache`] = true;
    filesExclude[`${engineNormalized}/Engine/Intermediate`] = true;
    filesExclude[`${engineNormalized}/Engine/Saved`] = true;
    filesExclude[`${engineNormalized}/FeaturePacks`] = true;
    filesExclude[`${engineNormalized}/Templates`] = true;

    const cppExclude: Record<string, boolean> = {
        '**/Binaries/**': true,
        '**/DerivedDataCache/**': true,
        '**/Saved/**': true,
    };
    cppExclude[`${engineNormalized}/Engine/Binaries/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Content/**`] = true;
    cppExclude[`${engineNormalized}/Engine/DerivedDataCache/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Intermediate/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Saved/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Shaders/**`] = true;
    cppExclude[`${engineNormalized}/FeaturePacks/**`] = true;
    cppExclude[`${engineNormalized}/Templates/**`] = true;

    const searchExclude: Record<string, boolean> = {
        '**/Binaries': true,
        '**/DerivedDataCache': true,
        '**/Intermediate': true,
        '**/Saved': true,
    };
    searchExclude[`${engineNormalized}/Engine/Content`] = true;
    searchExclude[`${engineNormalized}/FeaturePacks`] = true;
    searchExclude[`${engineNormalized}/Templates`] = true;

    return { watcherExclude, filesExclude, cppExclude, searchExclude };
}

export function excludeSettings(enginePath: string): Record<string, any> {
    const maps = buildExcludeMaps(enginePath);
    return {
        'files.watcherExclude': maps.watcherExclude,
        'files.exclude': maps.filesExclude,
        'C_Cpp.files.exclude': maps.cppExclude,
        'search.exclude': maps.searchExclude,
    };
}

/** Merge settings into .code-workspace (creates warning if missing). */
export async function patchCodeWorkspace(
    projectPath: string,
    settingsPatch: Record<string, any>
): Promise<{ workspaceFile: string | undefined; patched: boolean }> {
    const workspaceFile = path.join(projectPath, `${path.basename(projectPath)}.code-workspace`);
    if (!(await fileExists(workspaceFile))) {
        return { workspaceFile: undefined, patched: false };
    }

    const ws = await readJson<any>(workspaceFile);
    if (!ws.settings) {
        ws.settings = {};
    }
    ws.settings = mergeSettingsWithExcludes(ws.settings, settingsPatch);
    await writeJson(workspaceFile, ws);
    return { workspaceFile, patched: true };
}

/** Mirror critical settings into .vscode/settings.json. */
export async function patchVscodeSettings(
    projectPath: string,
    settingsPatch: Record<string, any>
): Promise<void> {
    const vscodeDir = path.join(projectPath, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });

    const settingsFile = path.join(vscodeDir, 'settings.json');
    let existing: Record<string, any> = {};
    if (await fileExists(settingsFile)) {
        try {
            existing = await readJson(settingsFile);
        } catch {
            existing = {};
        }
    }

    const merged = mergeSettingsWithExcludes(existing, settingsPatch);
    await writeJson(settingsFile, merged);
}
