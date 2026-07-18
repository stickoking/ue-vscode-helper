import * as vscode from 'vscode';
import { HostKind, getHelperSetting } from './host';
import { resolveCodeWorkspaceFile } from './excludes';
import { readJsonc, writeJson } from './util';

export type EnsureExtensionsMode = 'required' | 'requiredAndOptional' | 'off';

export interface ExtensionEntry {
    id: string;
    label: string;
    /** If any of these are installed, this entry is satisfied (e.g. Python). */
    satisfiedBy?: string[];
}

const CURSOR_REQUIRED: ExtensionEntry[] = [
    { id: 'llvm-vs-code-extensions.vscode-clangd', label: 'clangd' },
    { id: 'anysphere.csharp', label: 'C# (Cursor)' },
];

const CURSOR_OPTIONAL: ExtensionEntry[] = [
    { id: 'ms-dotnettools.vscode-dotnet-runtime', label: '.NET Install Tool' },
    { id: 'anysphere.cpptools', label: 'C/C++ (Cursor debug)' },
];

/** Prefer Cursor Pyright; either Pyright or ms-python.python counts as satisfied. */
const CURSOR_PYTHON: ExtensionEntry = {
    id: 'anysphere.cursorpyright',
    label: 'Python (Cursor Pyright)',
    satisfiedBy: ['anysphere.cursorpyright', 'ms-python.python'],
};

const VSCODE_REQUIRED: ExtensionEntry[] = [
    { id: 'ms-vscode.cpptools', label: 'C/C++' },
    { id: 'ms-dotnettools.csharp', label: 'C#' },
];

const VSCODE_OPTIONAL: ExtensionEntry[] = [
    { id: 'ms-dotnettools.csdevkit', label: 'C# Dev Kit' },
    { id: 'ms-dotnettools.vscode-dotnet-runtime', label: '.NET Install Tool' },
    { id: 'ms-vscode.cmake-tools', label: 'CMake Tools' },
];

/** VS Code: only ms-python.python — never Cursor-only anysphere.cursorpyright. */
const VSCODE_PYTHON: ExtensionEntry = {
    id: 'ms-python.python',
    label: 'Python',
};

/** Never recommend/install on Cursor. */
const CURSOR_AVOID_IDS = new Set(['ms-vscode.cpptools']);

function isInstalled(id: string): boolean {
    return !!vscode.extensions.getExtension(id);
}

function isSatisfied(entry: ExtensionEntry): boolean {
    const ids = entry.satisfiedBy ?? [entry.id];
    return ids.some(isInstalled);
}

/**
 * Build the install checklist for the current host + settings.
 * Python is required-adjacent when promptPython is true (included even on `required`).
 */
export function buildExtensionChecklist(
    host: HostKind,
    mode: EnsureExtensionsMode,
    promptPython: boolean
): ExtensionEntry[] {
    if (mode === 'off') {
        return [];
    }

    const required = host === 'cursor' ? CURSOR_REQUIRED : VSCODE_REQUIRED;
    const optional = host === 'cursor' ? CURSOR_OPTIONAL : VSCODE_OPTIONAL;
    const python = host === 'cursor' ? CURSOR_PYTHON : VSCODE_PYTHON;

    const list: ExtensionEntry[] = [...required];
    if (mode === 'requiredAndOptional') {
        list.push(...optional);
    }
    if (promptPython) {
        list.push(python);
    }
    return list;
}

/** Host-aware marketplace recommendations for `.code-workspace` (never Cursor-avoid IDs). */
export function hostRecommendations(host: HostKind, promptPython: boolean): string[] {
    const required = host === 'cursor' ? CURSOR_REQUIRED : VSCODE_REQUIRED;
    const optional = host === 'cursor' ? CURSOR_OPTIONAL : VSCODE_OPTIONAL;
    const python = host === 'cursor' ? CURSOR_PYTHON : VSCODE_PYTHON;

    const ids = [...required, ...optional].map((e) => e.id);
    if (promptPython) {
        ids.push(python.id);
    }
    if (host === 'cursor') {
        return ids.filter((id) => !CURSOR_AVOID_IDS.has(id));
    }
    return ids;
}

async function installExtension(id: string): Promise<boolean> {
    try {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
        return true;
    } catch {
        try {
            await vscode.commands.executeCommand('workbench.extensions.search', `@id:${id}`);
        } catch {
            // ignore — soft prompt only
        }
        return false;
    }
}

/**
 * Soft prompt for missing extensions. Never hard-fails.
 * Call BEFORE profile/config patch (extensions can overwrite settings on first install).
 * Dialogs must stay outside `withProgress`.
 */
export async function ensureExtensions(
    host: HostKind,
    projectPath?: string
): Promise<string | undefined> {
    const mode =
        (await getHelperSetting<EnsureExtensionsMode>(
            projectPath,
            'ensureExtensions',
            'requiredAndOptional'
        )) ?? 'requiredAndOptional';
    const promptPython = await getHelperSetting<boolean>(projectPath, 'promptPython', true);

    if (mode === 'off') {
        return undefined;
    }

    const checklist = buildExtensionChecklist(host, mode, promptPython);
    const missing = checklist.filter((e) => !isSatisfied(e));
    if (missing.length === 0) {
        return undefined;
    }

    const hostLabel = host === 'cursor' ? 'Cursor' : 'VS Code';
    const names = missing.map((e) => e.label).join(', ');
    const choice = await vscode.window.showInformationMessage(
        `UE Helper (${hostLabel}): missing extensions — ${names}.\nInstall now? (Setup continues either way.)`,
        'Install',
        'Dismiss'
    );

    if (choice !== 'Install') {
        return `Skipped installing: ${names}`;
    }

    const installed: string[] = [];
    const opened: string[] = [];
    for (const entry of missing) {
        const ok = await installExtension(entry.id);
        if (ok) {
            installed.push(entry.label);
        } else {
            opened.push(entry.label);
        }
    }

    const parts: string[] = [];
    if (installed.length > 0) {
        parts.push(`Installed: ${installed.join(', ')}`);
    }
    if (opened.length > 0) {
        parts.push(`Opened marketplace search for: ${opened.join(', ')}`);
    }
    return parts.join('. ') || undefined;
}

/** Rewrite `.code-workspace` `extensions.recommendations` to the host-aware list. */
export async function rewriteWorkspaceRecommendations(
    projectPath: string,
    projectName: string,
    host: HostKind
): Promise<boolean> {
    const workspaceFile = await resolveCodeWorkspaceFile(projectPath, projectName);
    if (!workspaceFile) {
        return false;
    }

    const promptPython = await getHelperSetting<boolean>(projectPath, 'promptPython', true);
    const recommendations = hostRecommendations(host, promptPython);

    const ws = await readJsonc<Record<string, any>>(workspaceFile);
    if (!ws.extensions || typeof ws.extensions !== 'object') {
        ws.extensions = {};
    }
    ws.extensions.recommendations = recommendations;

    const unwanted: string[] = Array.isArray(ws.extensions.unwantedRecommendations)
        ? [...ws.extensions.unwantedRecommendations]
        : [];

    // Cursor: mark MS cpptools unwanted. VS Code: remove those IDs so a prior
    // Cursor Setup does not leave the required C++ extension marked unwanted.
    if (host === 'cursor') {
        for (const id of CURSOR_AVOID_IDS) {
            if (!unwanted.includes(id)) {
                unwanted.push(id);
            }
        }
        ws.extensions.unwantedRecommendations = unwanted;
    } else {
        const cleaned = unwanted.filter((id) => !CURSOR_AVOID_IDS.has(id));
        if (cleaned.length > 0) {
            ws.extensions.unwantedRecommendations = cleaned;
        } else {
            delete ws.extensions.unwantedRecommendations;
        }
    }

    await writeJson(workspaceFile, ws);
    return true;
}
