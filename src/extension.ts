import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ UE VS Code Helper is now active!');

    context.subscriptions.push(
        vscode.commands.registerCommand('ue-vscode-helper.setup', setupUnrealProject),
        vscode.commands.registerCommand('ue-vscode-helper.initGit', initGitProject)
    );
}

async function setupUnrealProject() {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return vscode.window.showErrorMessage('Open your Unreal Engine project folder first.');

    const projectPath = workspace.uri.fsPath;
    const uprojectFiles = await vscode.workspace.findFiles('**/*.uproject', '**/node_modules/**', 1);
    if (uprojectFiles.length === 0) return vscode.window.showErrorMessage('No .uproject file found.');

    const projectName = path.basename(uprojectFiles[0].fsPath, '.uproject');
    const config = vscode.workspace.getConfiguration('ue-vscode-helper');
    let enginePath = config.get<string>('enginePath') || 'C:\\Program Files\\Epic Games\\UE_5.4';
    enginePath = enginePath.replace(/\\+$/, '');

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `UE Helper — ${projectName}`,
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Patching IntelliSense & excludes...' });
        try {
            await patchCppProperties(projectPath, enginePath, projectName);
            await patchWorkspaceSettings(projectPath, enginePath);
            vscode.window.showInformationMessage(`✅ IntelliSense & excludes patched for ${projectName}!`);
            vscode.window.showInformationMessage('Press Ctrl+R to reload window.');
        } catch (err: unknown) {
            vscode.window.showErrorMessage(`Setup failed: ${(err as Error).message}`);
        }
    });
}

// ── IntelliSense patch ─────────────────────────────
async function patchCppProperties(projectPath: string, enginePath: string, projectName: string) {
    const vscodeDir = path.join(projectPath, '.vscode');
    const propsFile = path.join(vscodeDir, 'c_cpp_properties.json');
    if (!(await fileExists(propsFile))) throw new Error('c_cpp_properties.json not found. Generate project files in UE first!');

    const props = JSON.parse(await fs.readFile(propsFile, 'utf8')) as any;
    let compileCommands = path.join(vscodeDir, `compileCommands_${projectName}.json`);
    if (!(await fileExists(compileCommands))) compileCommands = path.join(vscodeDir, 'compileCommands_Default.json');

    const definitionsHeader = path.join(projectPath, `Intermediate\\Build\\Win64\\x64\\UnrealEditor\\Development\\${projectName}\\Definitions.${projectName}.h`).replace(/\\/g, '/');
    const sharedDefsDir = path.join(projectPath, `Intermediate\\Build\\Win64\\x64\\${projectName}Editor\\Development\\UnrealEd`).replace(/\\/g, '/');

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

    await fs.writeFile(propsFile, JSON.stringify({ configurations: [newConfig], version: 4 }, null, 4), 'utf8');
}

// ── Excludes patch ─────────────────────────────────────────────
async function patchWorkspaceSettings(projectPath: string, enginePath: string) {
    const workspaceFile = path.join(projectPath, `${path.basename(projectPath)}.code-workspace`);
    if (!(await fileExists(workspaceFile))) {
        vscode.window.showWarningMessage('.code-workspace not found — skipping excludes.');
        return;
    }

    const ws = JSON.parse(await fs.readFile(workspaceFile, 'utf8')) as any;
    if (!ws.settings) ws.settings = {};

    const engineNormalized = enginePath.replace(/\\/g, '/');

    const watcherExclude = {
        "**/.git/objects/**": true,
        "**/node_modules/**": true,
        "**/Binaries/**": true,
        "**/DerivedDataCache/**": true,
        "**/Intermediate/**": true,
        "**/Saved/**": true
    } as Record<string, boolean>;
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

    const searchExclude: Record<string, boolean> = {
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

// ── Git init with strong guards ──────────────────────────────────────────────
async function initGitProject() {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return vscode.window.showErrorMessage('Open your Unreal project first.');

    const projectPath = workspace.uri.fsPath;
    const gitDir = path.join(projectPath, '.git');

    if (await fileExists(gitDir)) {
        return vscode.window.showInformationMessage('✅ Git repo already exists — skipping init.');
    }

    // Check if git is installed
    try {
        await new Promise<void>((resolve, reject) => {
            exec('git --version', (err) => err ? reject(err) : resolve());
        });
    } catch {
        return vscode.window.showErrorMessage('Git is not installed or not in PATH. Install it from https://git-scm.com');
    }

    const answer = await vscode.window.showInformationMessage(
        'Initialise Git repo + UE .gitignore + initial commit?',
        { modal: true }, 'Yes', 'Cancel'
    );
    if (answer !== 'Yes') return;

    try {
        await new Promise<void>((resolve, reject) => {
            exec('git init', { cwd: projectPath }, (err) => err ? reject(err) : resolve());
        });
        vscode.window.showInformationMessage('Git repo initialised.');

        // Write .gitignore (exact same as your PS1)
        const gitignoreContent = `# Unreal Engine generated folders
Binaries/
Build/
DerivedDataCache/
Intermediate/
Saved/

# Compiled bytecode / build artifacts
*.pyc
*.pyo

# VS Code IntelliSense generated compile commands
.vscode/compileCommands_*/
.vscode/compileCommands_*.json

# Visual Studio files
.vs/
*.suo
*.user
*.sdf
*.opensdf
*.sln
*.vcxproj
*.vcxproj.filters

# Xcode
*.xcworkspace
*.xcodeproj

# JetBrains Rider
.idea/
*.iml

# OS junk
.DS_Store
Thumbs.db
Desktop.ini

# Unreal crash reports and logs
Crash/
*.log
*.dmp

# Packaged builds (uncomment if you do NOT want to track these)
# Releases/
`;
        await fs.writeFile(path.join(projectPath, '.gitignore'), gitignoreContent, 'utf8');

        await new Promise<void>((resolve, reject) => {
            exec('git add .', { cwd: projectPath }, (err) => err ? reject(err) : resolve());
        });
        await new Promise<void>((resolve, reject) => {
            exec('git commit -m "Initial commit — Unreal project + VS Code config"', { cwd: projectPath }, (err) => err ? reject(err) : resolve());
        });

        vscode.window.showInformationMessage('✅ Initial commit created!');

        // Optional remote
        const addRemote = await vscode.window.showInformationMessage('Add GitHub remote now?', 'Yes', 'Later');
        if (addRemote === 'Yes') {
            const remoteUrl = await vscode.window.showInputBox({
                prompt: 'GitHub repo URL[](https://github.com/username/repo.git)',
                placeHolder: 'https://github.com/yourusername/MyGame.git'
            });
            if (remoteUrl) {
                await new Promise<void>((resolve, reject) => {
                    exec(`git remote add origin ${remoteUrl}`, { cwd: projectPath }, (err) => err ? reject(err) : resolve());
                });
                vscode.window.showInformationMessage(`Remote 'origin' added! Run 'git push -u origin main' when ready.`);
            }
        }
    } catch (err: unknown) {
        vscode.window.showErrorMessage(`Git init failed: ${(err as Error).message}`);
    }
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