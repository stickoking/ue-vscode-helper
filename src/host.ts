import * as vscode from 'vscode';

export type HostKind = 'cursor' | 'vscode';
export type PreferHost = 'auto' | 'cursor' | 'vscode';

export function detectHost(): HostKind {
    return /cursor/i.test(vscode.env.appName) ? 'cursor' : 'vscode';
}

export function resolveHost(preferHost?: PreferHost): HostKind {
    const prefer = preferHost ?? vscode.workspace.getConfiguration('ue-vscode-helper').get<PreferHost>('preferHost') ?? 'auto';
    if (prefer === 'cursor' || prefer === 'vscode') {
        return prefer;
    }
    return detectHost();
}
