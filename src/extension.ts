import * as path from 'path';
import * as vscode from 'vscode';
import { resolveHost, HostKind } from './host';
import {
    buildRulesIntelliSenseCsproj,
    buildRulesIntelliSenseSln,
    buildRulesIntelliSenseSlnRelative,
    findProjectInfo,
    ProjectInfo,
    resolveUprojectPath,
} from './engine';
import {
    excludeSettings,
    patchCodeWorkspace,
    patchVscodeSettings,
    resolveCodeWorkspaceFile,
} from './excludes';
import { ensureExtensions, rewriteWorkspaceRecommendations } from './extensions';
import {
    buildCursorSettings,
    restoreBuildRulesIntelliSense,
    writeBuildRulesIntelliSenseCsproj,
    writeBuildRulesIntelliSenseSln,
    writeCursorSecondaryArtifacts,
} from './profiles/cursor';
import { buildVsCodeSettings, patchCppProperties } from './profiles/vscode';
import { initGitProject } from './git';
import { fileExists, HardDiskTransaction, readJsonc } from './util';

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ UE VS Code / Cursor Helper is now active!');

    context.subscriptions.push(
        vscode.commands.registerCommand('ue-vscode-helper.setup', setupUnrealProject),
        vscode.commands.registerCommand('ue-vscode-helper.initGit', initGitProject)
    );
}

/**
 * Validate JSONC targets Setup will merge BEFORE any hard-path disk writes.
 */
async function preflightSetupTargets(info: ProjectInfo, _host: HostKind): Promise<void> {
    const workspaceFile = await resolveCodeWorkspaceFile(info.projectPath, info.projectName);
    if (workspaceFile) {
        try {
            await readJsonc(workspaceFile);
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
            await readJsonc(settingsFile);
        } catch (err: unknown) {
            throw new Error(
                `Invalid JSON in .vscode/settings.json — fix it before Setup. ${(err as Error).message}`
            );
        }
    }
}

/**
 * HARD path (all-or-nothing): snapshot every file this phase may change, write
 * BuildRules (Cursor) + settings/workspace/recommendations, roll EVERYTHING back
 * together if any step throws.
 *
 * SOFT path (after hard commits): clangd / compile_commands / dotnet restore —
 * notes only, never fails Setup and never needs rollback.
 * VS Code `c_cpp_properties.json` is patched in the hard phase (still supported).
 *
 * This single boundary is what stops the endless Bugbot sibling comments about
 * half-applied Setup.
 */
async function runHardSetupPhase(
    info: ProjectInfo,
    host: HostKind
): Promise<{ settings: Record<string, any>; notes: string[] }> {
    const notes: string[] = [];
    const workspaceFile = await resolveCodeWorkspaceFile(info.projectPath, info.projectName);
    const settingsFile = path.join(info.projectPath, '.vscode', 'settings.json');
    const csprojPath = buildRulesIntelliSenseCsproj(info.projectPath, info.projectName);
    const slnPath = buildRulesIntelliSenseSln(info.projectPath, info.projectName);
    const cppPropsFile = path.join(info.projectPath, '.vscode', 'c_cpp_properties.json');

    const tx = new HardDiskTransaction();
    // Track ALL hard targets BEFORE any write — one rollback set, no shifting boundary.
    await tx.track(settingsFile);
    if (workspaceFile) {
        await tx.track(workspaceFile);
    }
    if (host === 'cursor') {
        await tx.track(csprojPath);
        await tx.track(slnPath);
    } else {
        // VS Code still patches c_cpp_properties — tracked so a mid-write failure rolls back.
        await tx.track(cppPropsFile);
    }

    const settings =
        host === 'cursor' ? await buildCursorSettings(info) : buildVsCodeSettings();

    try {
        if (host === 'cursor') {
            const slnRelative = buildRulesIntelliSenseSlnRelative(info.projectName);
            try {
                const { rulesCount } = await writeBuildRulesIntelliSenseCsproj(info);
                await writeBuildRulesIntelliSenseSln(info);
                settings['dotnet.defaultSolution'] = slnRelative;
                notes.push(
                    `Slim BuildRules IntelliSense csproj+sln written (${rulesCount} rules file(s); no UE5Rules). ` +
                        `dotnet.defaultSolution → ${slnRelative}`
                );
            } catch (err: unknown) {
                // Soft-fail BuildRules: restore ONLY csproj/sln (settings not written yet).
                // Do not gate priorPair on rolling back unrelated tracked files.
                const brOk = await tx.rollbackOnly([csprojPath, slnPath]);
                const priorPair =
                    brOk && (await fileExists(csprojPath)) && (await fileExists(slnPath));
                if (priorPair) {
                    settings['dotnet.defaultSolution'] = slnRelative;
                    notes.push(
                        `Warning: Slim BuildRules IntelliSense update failed — restored previous csproj+sln. ` +
                            `${(err as Error).message}`
                    );
                } else {
                    settings['dotnet.defaultSolution'] = undefined;
                    notes.push(
                        `Warning: Slim BuildRules IntelliSense csproj/sln failed — ` +
                            `dotnet.defaultSolution was not set. ${(err as Error).message}` +
                            (brOk ? '' : ' (BuildRules rollback incomplete)')
                    );
                }
            }
        }

        const shared = excludeSettings(info.enginePath);
        const allSettings = { ...settings, ...shared };

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

        if (host === 'vscode') {
            // Still fully supported — inside the hard transaction after settings.
            // Missing/invalid UE-generated props: soft note + restore props snapshot only
            // so Cursor leftover cleanup in settings still commits.
            try {
                await patchCppProperties(info);
            } catch (err: unknown) {
                await tx.rollbackOnly([cppPropsFile]);
                notes.push(
                    `Warning: c_cpp_properties.json not patched — ${(err as Error).message} ` +
                        `VS Code host settings were still applied.`
                );
            }
        }

        return { settings: allSettings, notes };
    } catch (err: unknown) {
        const rolledBack = await tx.rollback();
        const base = (err as Error).message;
        if (!rolledBack) {
            throw new Error(
                `${base} (Setup also failed to fully roll back hard-path files — check .code-workspace / .vscode/settings.json / BuildRules IntelliSense files)`
            );
        }
        throw err;
    }
}

async function setupUnrealProject() {
    if (!vscode.workspace.workspaceFolders?.length) {
        return vscode.window.showErrorMessage('Open your Unreal Engine project folder first.');
    }

    const uproject = await resolveUprojectPath();
    if (uproject.status === 'cancelled') {
        return;
    }
    if (uproject.status === 'none') {
        return vscode.window.showErrorMessage('No .uproject file found.');
    }

    const info = await findProjectInfo(uproject.uprojectPath);
    if (!info) {
        return vscode.window.showErrorMessage('No .uproject file found.');
    }

    const host = resolveHost();
    const hostLabel = host === 'cursor' ? 'Cursor' : 'VS Code';
    const notes: string[] = [];
    let succeeded = false;

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
                            ? 'Writing BuildRules & settings...'
                            : 'Patching VS Code settings...',
                });
                const hard = await runHardSetupPhase(info, host);
                notes.push(...hard.notes);

                // SOFT phase — never throws into Setup failure / never rolls back hard path.
                if (host === 'cursor') {
                    progress.report({ message: 'Writing clangd & compile_commands...' });
                    notes.push(...(await writeCursorSecondaryArtifacts(info)));

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
