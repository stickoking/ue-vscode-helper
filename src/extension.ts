import * as path from 'path';
import * as vscode from 'vscode';
import { resolveHost, HostKind } from './host';
import { findProjectInfo, ProjectInfo } from './engine';
import {
    excludeSettings,
    patchCodeWorkspace,
    patchVscodeSettings,
    resolveCodeWorkspaceFile,
} from './excludes';
import { ensureExtensions, rewriteWorkspaceRecommendations } from './extensions';
import { applyCursorProfile, restoreBuildRulesIntelliSense } from './profiles/cursor';
import { applyVsCodeProfile } from './profiles/vscode';
import { initGitProject } from './git';
import { fileExists, readJson } from './util';

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ UE VS Code / Cursor Helper is now active!');

    context.subscriptions.push(
        vscode.commands.registerCommand('ue-vscode-helper.setup', setupUnrealProject),
        vscode.commands.registerCommand('ue-vscode-helper.initGit', initGitProject)
    );
}

/**
 * Validate targets that Setup will patch BEFORE writing clangd / BuildRules /
 * compile_commands. Prevents "Setup failed" after profile files already changed
 * on disk (e.g. invalid `.code-workspace` JSON).
 */
async function preflightSetupTargets(info: ProjectInfo, host: HostKind): Promise<void> {
    const workspaceFile = await resolveCodeWorkspaceFile(info.projectPath, info.projectName);
    if (workspaceFile) {
        try {
            await readJson(workspaceFile);
        } catch (err: unknown) {
            throw new Error(
                `Invalid JSON in ${path.basename(workspaceFile)} — fix or regenerate the workspace file before Setup. ${
                    (err as Error).message
                }`
            );
        }
    }

    const settingsFile = path.join(info.projectPath, '.vscode', 'settings.json');
    if (await fileExists(settingsFile)) {
        try {
            await readJson(settingsFile);
        } catch (err: unknown) {
            throw new Error(
                `Invalid JSON in .vscode/settings.json — fix it before Setup. ${(err as Error).message}`
            );
        }
    }

    if (host === 'vscode') {
        const propsFile = path.join(info.projectPath, '.vscode', 'c_cpp_properties.json');
        if (!(await fileExists(propsFile))) {
            throw new Error('c_cpp_properties.json not found. Generate project files in UE first!');
        }
        try {
            await readJson(propsFile);
        } catch (err: unknown) {
            throw new Error(
                `Invalid JSON in c_cpp_properties.json — regenerate project files in UE. ${
                    (err as Error).message
                }`
            );
        }
    }
}

async function setupUnrealProject() {
    const info = await findProjectInfo();
    if (!info) {
        const hasFolder = !!vscode.workspace.workspaceFolders?.[0];
        return vscode.window.showErrorMessage(
            hasFolder ? 'No .uproject file found.' : 'Open your Unreal Engine project folder first.'
        );
    }

    const host = resolveHost();
    const hostLabel = host === 'cursor' ? 'Cursor' : 'VS Code';
    const notes: string[] = [];
    let succeeded = false;

    // Extensions FIRST (outside withProgress). First-run extension setup can overwrite
    // configs if we patch settings before installs complete.
    const extNote = await ensureExtensions(host);
    if (extNote) {
        notes.push(extNote);
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `UE Helper (${hostLabel}) — ${info.projectName}`,
            cancellable: false,
        },
        async (progress) => {
            try {
                progress.report({ message: 'Validating workspace targets...' });
                await preflightSetupTargets(info, host);

                progress.report({
                    message:
                        host === 'cursor'
                            ? 'Writing clangd config & compile_commands...'
                            : 'Applying VS Code C++ profile...',
                });

                const profileResult =
                    host === 'cursor' ? await applyCursorProfile(info) : await applyVsCodeProfile(info);
                notes.push(...profileResult.notes);

                // Write IntelliSense + excludes BEFORE optional restore so C# settings
                // are always on disk even if restore is slow/fails.
                progress.report({ message: 'Patching excludes & settings...' });
                const shared = excludeSettings(info.enginePath);
                const allSettings = { ...profileResult.settings, ...shared };

                const { patched } = await patchCodeWorkspace(
                    info.projectPath,
                    info.projectName,
                    allSettings
                );
                if (!patched) {
                    notes.push('.code-workspace not found — patched .vscode/settings.json only.');
                }

                await patchVscodeSettings(info.projectPath, allSettings);
                await rewriteWorkspaceRecommendations(info.projectPath, info.projectName, host);

                if (host === 'cursor') {
                    progress.report({
                        message: 'Restoring BuildRules IntelliSense (slim csproj)...',
                    });
                    const restoreNote = await restoreBuildRulesIntelliSense(info);
                    if (restoreNote) {
                        notes.push(restoreNote);
                    }
                }

                succeeded = true;
            } catch (err: unknown) {
                vscode.window.showErrorMessage(`Setup failed: ${(err as Error).message}`);
            }
        }
    );

    if (!succeeded) {
        return;
    }

    // Single Reload prompt after extensions + config (outside withProgress).
    const noteText = notes.length > 0 ? `\n${notes.join('\n')}` : '';
    const reload = await vscode.window.showInformationMessage(
        `✅ ${hostLabel} IntelliSense & excludes patched for ${info.projectName}.${noteText}\n\nReload the window — required for IntelliSense settings to apply.`,
        'Reload Window',
        'Later'
    );
    if (reload === 'Reload Window') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

export function deactivate() {}
