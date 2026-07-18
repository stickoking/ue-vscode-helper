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
 * Does NOT prefer `.code-workspace` settings over the game file (intentional —
 * multi-root / wrong-folder Bugbot; see intentional-designs.mdc).
 * Falls back to unscoped config only when the project file is missing the key.
 * If the project settings file exists but is invalid JSONC, throws (no silent
 * fallback) so Setup cannot prompt extensions then abort (PR: Setup before JSON).
 */
export async function getHelperSetting<T>(
    projectPath: string | undefined,
    key: string,
    defaultValue: T
): Promise<T> {
    if (projectPath) {
        const settingsFile = path.join(projectPath, '.vscode', 'settings.json');
        if (await fileExists(settingsFile)) {
            let raw: Record<string, unknown>;
            try {
                raw = await readJsonc<Record<string, unknown>>(settingsFile);
            } catch (err: unknown) {
                throw new Error(
                    `Invalid JSON in .vscode/settings.json — fix it before Setup. ${
                        (err as Error).message
                    }`
                );
            }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error(
                    'Invalid JSON in .vscode/settings.json — root must be a JSON object. Fix it before Setup.'
                );
            }
            const fullKey = `ue-vscode-helper.${key}`;
            if (Object.prototype.hasOwnProperty.call(raw, fullKey) && raw[fullKey] !== undefined) {
                return raw[fullKey] as T;
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
