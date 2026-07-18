import * as path from 'path';
import * as vscode from 'vscode';
import { fileExists, readJsonc } from './util';

export type HostKind = 'cursor' | 'vscode';
export type PreferHost = 'auto' | 'cursor' | 'vscode';

export function detectHost(): HostKind {
    return /cursor/i.test(vscode.env.appName) ? 'cursor' : 'vscode';
}

/**
 * Read ue-vscode-helper.* from the game's own `.vscode/settings.json` first.
 * Does NOT use getConfiguration(resource) — that was the prior bounce fix.
 * Falls back to unscoped config only when the project file has no key.
 */
export async function getHelperSetting<T>(
    projectPath: string | undefined,
    key: string,
    defaultValue: T
): Promise<T> {
    if (projectPath) {
        const settingsFile = path.join(projectPath, '.vscode', 'settings.json');
        if (await fileExists(settingsFile)) {
            try {
                const raw = await readJsonc<Record<string, unknown>>(settingsFile);
                const fullKey = `ue-vscode-helper.${key}`;
                if (Object.prototype.hasOwnProperty.call(raw, fullKey) && raw[fullKey] !== undefined) {
                    return raw[fullKey] as T;
                }
            } catch {
                // fall through
            }
        }
    }
    return (
        vscode.workspace.getConfiguration('ue-vscode-helper').get<T>(key, defaultValue) ??
        defaultValue
    );
}

export function resolveHost(preferHost?: PreferHost): HostKind {
    const prefer = preferHost ?? 'auto';
    if (prefer === 'cursor' || prefer === 'vscode') {
        return prefer;
    }
    return detectHost();
}
