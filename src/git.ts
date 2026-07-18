import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { fileExists } from './util';

function runGit(args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd }, (err) => (err ? reject(err) : resolve()));
    });
}

/** Accept https/ssh git remotes; reject shell metacharacters even though we use execFile. */
function isSafeGitRemoteUrl(url: string): boolean {
    const trimmed = url.trim();
    if (!trimmed || /[\r\n\0]/.test(trimmed)) {
        return false;
    }
    return (
        /^https:\/\/[^\s]+$/i.test(trimmed) ||
        /^git@[^\s]+:[^\s]+$/i.test(trimmed) ||
        /^ssh:\/\/[^\s]+$/i.test(trimmed)
    );
}

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
        await runGit(['--version'], projectPath);
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
        await runGit(['init'], projectPath);
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

        await runGit(['add', '.'], projectPath);
        await runGit(
            ['commit', '-m', 'Initial commit — Unreal project + editor config'],
            projectPath
        );

        vscode.window.showInformationMessage('✅ Initial commit created!');

        const addRemote = await vscode.window.showInformationMessage('Add GitHub remote now?', 'Yes', 'Later');
        if (addRemote === 'Yes') {
            const remoteUrl = await vscode.window.showInputBox({
                prompt: 'GitHub repo URL (https://github.com/username/repo.git)',
                placeHolder: 'https://github.com/yourusername/MyGame.git',
            });
            if (remoteUrl) {
                const trimmed = remoteUrl.trim();
                if (!isSafeGitRemoteUrl(trimmed)) {
                    return void vscode.window.showErrorMessage(
                        'Invalid remote URL. Use https://…, git@host:path, or ssh://… with no spaces.'
                    );
                }
                // execFile + argv — never interpolate the URL into a shell string.
                await runGit(['remote', 'add', 'origin', trimmed], projectPath);
                vscode.window.showInformationMessage(
                    `Remote 'origin' added! Run 'git push -u origin main' when ready.`
                );
            }
        }
    } catch (err: unknown) {
        vscode.window.showErrorMessage(`Git init failed: ${(err as Error).message}`);
    }
}
