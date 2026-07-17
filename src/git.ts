import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { fileExists } from './util';

export async function initGitProject(): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        return void vscode.window.showErrorMessage('Open your Unreal project first.');
    }

    const projectPath = workspace.uri.fsPath;
    const gitDir = path.join(projectPath, '.git');

    if (await fileExists(gitDir)) {
        return void vscode.window.showInformationMessage('✅ Git repo already exists — skipping init.');
    }

    try {
        await new Promise<void>((resolve, reject) => {
            exec('git --version', (err) => (err ? reject(err) : resolve()));
        });
    } catch {
        return void vscode.window.showErrorMessage(
            'Git is not installed or not in PATH. Install it from https://git-scm.com'
        );
    }

    const answer = await vscode.window.showInformationMessage(
        'Initialise Git repo + UE .gitignore + initial commit?',
        { modal: true },
        'Yes',
        'Cancel'
    );
    if (answer !== 'Yes') {
        return;
    }

    try {
        await new Promise<void>((resolve, reject) => {
            exec('git init', { cwd: projectPath }, (err) => (err ? reject(err) : resolve()));
        });
        vscode.window.showInformationMessage('Git repo initialised.');

        const gitignoreContent = `# Unreal Engine generated folders
Binaries/
Build/
DerivedDataCache/
Intermediate/
Saved/

# Compiled bytecode / build artifacts
*.pyc
*.pyo

# VS Code / Cursor IntelliSense generated compile commands
.vscode/compileCommands_*/
.vscode/compileCommands_*.json
compile_commands.json
.cache/

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
            exec('git add .', { cwd: projectPath }, (err) => (err ? reject(err) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
            exec(
                'git commit -m "Initial commit — Unreal project + editor config"',
                { cwd: projectPath },
                (err) => (err ? reject(err) : resolve())
            );
        });

        vscode.window.showInformationMessage('✅ Initial commit created!');

        const addRemote = await vscode.window.showInformationMessage('Add GitHub remote now?', 'Yes', 'Later');
        if (addRemote === 'Yes') {
            const remoteUrl = await vscode.window.showInputBox({
                prompt: 'GitHub repo URL (https://github.com/username/repo.git)',
                placeHolder: 'https://github.com/yourusername/MyGame.git',
            });
            if (remoteUrl) {
                await new Promise<void>((resolve, reject) => {
                    exec(`git remote add origin ${remoteUrl}`, { cwd: projectPath }, (err) =>
                        err ? reject(err) : resolve()
                    );
                });
                vscode.window.showInformationMessage(
                    `Remote 'origin' added! Run 'git push -u origin main' when ready.`
                );
            }
        }
    } catch (err: unknown) {
        vscode.window.showErrorMessage(`Git init failed: ${(err as Error).message}`);
    }
}
