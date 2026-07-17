import * as path from 'path';
import * as fs from 'fs/promises';
import { fileExists, readJson, writeJson, mergeSettings, normalizeSlashes } from './util';

export interface ExcludeMaps {
    watcherExclude: Record<string, boolean>;
    filesExclude: Record<string, boolean>;
    cppExclude: Record<string, boolean>;
    searchExclude: Record<string, boolean>;
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
    ws.settings = mergeSettings(ws.settings, settingsPatch);
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

    const merged = mergeSettings(existing, settingsPatch);
    await writeJson(settingsFile, merged);
}
