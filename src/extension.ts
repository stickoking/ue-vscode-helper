import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ UE VS Code Helper is now active!');

    const setupDisposable = vscode.commands.registerCommand('ue-vscode-helper.setup', async () => {
        await setupUnrealProject();
    });

    const gitDisposable = vscode.commands.registerCommand('ue-vscode-helper.initGit', async () => {
        vscode.window.showInformationMessage('Git init coming in Step 5!');
    });

    context.subscriptions.push(setupDisposable, gitDisposable);
}

async function setupUnrealProject() {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        return vscode.window.showErrorMessage('Please open your Unreal Engine project folder first.');
    }

    const projectPath = workspace.uri.fsPath;

    const uprojectFiles = await vscode.workspace.findFiles('**/*.uproject', '**/node_modules/**', 1);
    if (uprojectFiles.length === 0) {
        return vscode.window.showErrorMessage('No .uproject file found — this must be the root of a UE project.');
    }

    const projectName = path.basename(uprojectFiles[0].fsPath, '.uproject');
    const config = vscode.workspace.getConfiguration('ue-vscode-helper');
    let enginePath = config.get<string>('enginePath') || 'C:\\Program Files\\Epic Games\\UE_5.4';
    
    // FIXED: Safe way to remove trailing backslashes (no trimEnd argument)
    enginePath = enginePath.replace(/\\+$/, '');

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `UE Helper — ${projectName}`,
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Patching IntelliSense...' });

        try {
            await patchCppProperties(projectPath, enginePath, projectName);
            await patchWorkspaceSettings(projectPath, enginePath);
            
            vscode.window.showInformationMessage(`✅ IntelliSense & excludes patched for ${projectName}!`);
            vscode.window.showInformationMessage('Press Ctrl+R (Reload Window) to apply changes.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Setup failed: ${err.message}`);
        }
    });
}

// ── Patch c_cpp_properties.json ─────────────────────────────────────────────
async function patchCppProperties(projectPath: string, enginePath: string, projectName: string) {
    const vscodeDir = path.join(projectPath, '.vscode');
    const propsFile = path.join(vscodeDir, 'c_cpp_properties.json');

    if (!(await fileExists(propsFile))) {
        throw new Error('c_cpp_properties.json not found. Generate project files in UE Editor first!');
    }

    let props: any = JSON.parse(await fs.readFile(propsFile, 'utf8'));

    let compileCommands = path.join(vscodeDir, `compileCommands_${projectName}.json`);
    if (!(await fileExists(compileCommands))) {
        compileCommands = path.join(vscodeDir, 'compileCommands_Default.json');
    }

    const definitionsHeader = path.join(
        projectPath,
        `Intermediate\\Build\\Win64\\x64\\UnrealEditor\\Development\\${projectName}\\Definitions.${projectName}.h`
    ).replace(/\\/g, '/');

    const sharedDefsDir = path.join(
        projectPath,
        `Intermediate\\Build\\Win64\\x64\\${projectName}Editor\\Development\\UnrealEd`
    ).replace(/\\/g, '/');

    const newConfig = {
        name: `${projectName}Editor Win64 Development`,
        compilerPath: props.configurations[0].compilerPath,
        cStandard: "c17",
        cppStandard: "c++20",
        intelliSenseMode: "msvc-x64",
        compileCommands: compileCommands.replace(/\\/g, '/'),
        includePath: [
            "${workspaceFolder}/Source",
            `${projectPath.replace(/\\/g, '/')}/Intermediate/Build/Win64/UnrealEditor/Inc/${projectName}/UHT`,
            sharedDefsDir,
            `${enginePath.replace(/\\/g, '/')}/Engine/Intermediate/Build/Win64/UnrealEditor/Inc/**`,
            `${enginePath.replace(/\\/g, '/')}/Engine/Intermediate/Build/Win64/UnrealGame/Inc/**`,
            `${enginePath.replace(/\\/g, '/')}/Engine/Source/**`
        ],
        forcedInclude: [definitionsHeader]
    };

    const newProps = {
        configurations: [newConfig],
        version: 4
    };

    await fs.writeFile(propsFile, JSON.stringify(newProps, null, 4), 'utf8');
}

// ── Patch .code-workspace excludes (safe step-by-step version) ───────────────
async function patchWorkspaceSettings(projectPath: string, enginePath: string) {
    const workspaceFile = path.join(projectPath, `${path.basename(projectPath)}.code-workspace`);

    if (!(await fileExists(workspaceFile))) {
        vscode.window.showWarningMessage('.code-workspace not found — skipping excludes.');
        return;
    }

    let ws: any = JSON.parse(await fs.readFile(workspaceFile, 'utf8'));
    if (!ws.settings) ws.settings = {};

    const engineNormalized = enginePath.replace(/\\/g, '/');

    // Safe object building (no template literal key issues)
    const watcherExclude: any = {
        "**/.git/objects/**": true,
        "**/node_modules/**": true,
        "**/Binaries/**": true,
        "**/DerivedDataCache/**": true,
        "**/Intermediate/**": true,
        "**/Saved/**": true
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

    const filesExclude: any = {};
    filesExclude[`${engineNormalized}/Engine/Binaries`] = true;
    filesExclude[`${engineNormalized}/Engine/Content`] = true;
    filesExclude[`${engineNormalized}/Engine/DerivedDataCache`] = true;
    filesExclude[`${engineNormalized}/Engine/Intermediate`] = true;
    filesExclude[`${engineNormalized}/Engine/Saved`] = true;
    filesExclude[`${engineNormalized}/FeaturePacks`] = true;
    filesExclude[`${engineNormalized}/Templates`] = true;

    const cppExclude: any = {
        "**/Binaries/**": true,
        "**/DerivedDataCache/**": true,
        "**/Saved/**": true
    };
    cppExclude[`${engineNormalized}/Engine/Binaries/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Content/**`] = true;
    cppExclude[`${engineNormalized}/Engine/DerivedDataCache/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Intermediate/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Saved/**`] = true;
    cppExclude[`${engineNormalized}/Engine/Shaders/**`] = true;
    cppExclude[`${engineNormalized}/FeaturePacks/**`] = true;
    cppExclude[`${engineNormalized}/Templates/**`] = true;

    const searchExclude: any = {
        "**/Binaries": true,
        "**/DerivedDataCache": true,
        "**/Intermediate": true,
        "**/Saved": true
    };
    searchExclude[`${engineNormalized}/Engine/Content`] = true;
    searchExclude[`${engineNormalized}/FeaturePacks`] = true;
    searchExclude[`${engineNormalized}/Templates`] = true;

    ws.settings['files.watcherExclude'] = watcherExclude;
    ws.settings['files.exclude'] = filesExclude;
    ws.settings['C_Cpp.files.exclude'] = cppExclude;
    ws.settings['search.exclude'] = searchExclude;

    await fs.writeFile(workspaceFile, JSON.stringify(ws, null, 4), 'utf8');
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export function deactivate() {}