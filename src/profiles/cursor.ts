import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import {
    buildRulesIntelliSenseCsproj,
    buildRulesIntelliSenseSln,
    epicGamesBuildCsproj,
    findUeDotNetPath,
    moduleRulesCsproj,
    ProjectInfo,
    unrealBuildToolCsproj,
    unrealEngineCsprojProps,
} from '../engine';
import { fileExists } from '../util';
import { createHash } from 'crypto';
import { getHelperSetting } from '../host';

/** Max wait for slim BuildRules IntelliSense `dotnet restore` — never block setup forever. */
export const BUILD_RULES_RESTORE_TIMEOUT_MS = 90_000;

/** @deprecated Use BUILD_RULES_RESTORE_TIMEOUT_MS */
export const MODULE_RULES_RESTORE_TIMEOUT_MS = BUILD_RULES_RESTORE_TIMEOUT_MS;

const CLANGD_ARGS = [
    '--background-index',
    '--header-insertion=never',
    '--completion-style=detailed',
    '--query-driver=C:/Program Files*/Microsoft Visual Studio/**/cl.exe,C:/Program Files (x86)/Microsoft Visual Studio/**/cl.exe',
];

const FILE_ASSOCIATIONS: Record<string, string> = {
    '*.h': 'cpp',
    '*.cpp': 'cpp',
    '*.hpp': 'cpp',
    '*.inl': 'cpp',
    '*.c': 'c',
    '*.cc': 'cpp',
    '*.cxx': 'cpp',
};

export async function buildCursorSettings(info: ProjectInfo): Promise<Record<string, any>> {
    const { enginePath } = info;
    const settings: Record<string, any> = {
        'clangd.enable': true,
        'clangd.arguments': CLANGD_ARGS,
        'C_Cpp.intelliSenseEngine': 'disabled',
        'C_Cpp.autocomplete': 'disabled',
        'C_Cpp.errorSquiggles': 'disabled',
        'C_Cpp.formatting': 'disabled',
        'files.associations': FILE_ASSOCIATIONS,
        // dotnet.defaultSolution is set only after slim csproj+sln write succeeds
        // (see runHardSetupPhase in extension.ts) — never point C# LS at a missing solution.
        'dotnet.backgroundAnalysis.compilerDiagnosticsScope': 'openFiles',
        'dotnet.backgroundAnalysis.analyzerDiagnosticsScope': 'openFiles',
        'omnisharp.projectLoadTimeout': 120,
        'omnisharp.enableRoslynAnalyzers': false,
        'omnisharp.enableEditorConfigSupport': false,
    };

    const dotNetPath = await findUeDotNetPath(enginePath);
    if (dotNetPath) {
        settings['dotnet.dotnetPath'] = dotNetPath;
        const winPath = dotNetPath.replace(/\//g, '\\');
        settings['terminal.integrated.env.windows'] = {
            PATH: `${winPath};\${env:PATH}`,
            DOTNET_ROOT: winPath,
            DOTNET_HOST_PATH: `${winPath}\\dotnet.exe`,
            DOTNET_MULTILEVEL_LOOKUP: '0',
            DOTNET_ROLL_FORWARD: 'LatestMajor',
        };
    } else {
        // Clear stale paths from a prior Setup if the engine/DotNet folder moved or vanished.
        // undefined → mergeSettings deletes the key (nested keys only for terminal env).
        settings['dotnet.dotnetPath'] = undefined;
        settings['terminal.integrated.env.windows'] = {
            PATH: undefined,
            DOTNET_ROOT: undefined,
            DOTNET_HOST_PATH: undefined,
            DOTNET_MULTILEVEL_LOOKUP: undefined,
            DOTNET_ROLL_FORWARD: undefined,
        };
    }

    return settings;
}

/**
 * Cursor `.clangd` — matches ObstacleAssault working config.
 * Project fragment: real diagnostics (syntax/types); only Unused/MissingIncludes off.
 * NEVER put Diagnostics.Suppress: ["*"] on the project fragment — that hides all squiggles.
 * Engine PathMatch: Suppress "*" + Index Skip (UE headers flood Problems otherwise).
 */
export function buildClangdConfigContent(): string {
    // PathMatch is YAML double-quoted; backslash escaping must match ObstacleAssault/.clangd.
    return `CompileFlags:
  CompilationDatabase: .
  Add:
    - /std:c++20
    - -ferror-limit=0
    - -Wno-everything
  Remove:
    - -std=c++14
Diagnostics:
  UnusedIncludes: None
  MissingIncludes: None
Index:
  Background: Build

---
# Engine install trees only (not a game living under "Epic Games/...").
# PathMatch requires Epic Games/UE_X.Y or UE_X.Y or Engine/Source — never bare "Epic Games".
If:
  PathMatch: ".*([/\\\\\\\\]Epic Games[/\\\\\\\\]UE_\\d+\\\\.\\d+[/\\\\\\\\]|[/\\\\\\\\]UE_\\d+\\\\.\\d+[/\\\\\\\\]|[/\\\\\\\\]Engine[/\\\\\\\\]Source[/\\\\\\\\]).*"
Index:
  Background: Skip
Diagnostics:
  UnusedIncludes: None
  MissingIncludes: None
  Suppress:
    - "*"
`;
}

export async function writeClangdConfig(projectPath: string): Promise<void> {
    const clangdPath = path.join(projectPath, '.clangd');
    await fs.writeFile(clangdPath, buildClangdConfigContent(), 'utf8');
}

export type CompileCommandsStatus = 'refreshed' | 'stale' | 'missing' | 'error';

/**
 * Ensure root compile_commands.json exists for clangd (CompilationDatabase: .).
 * Prefer `.vscode/compileCommands_<Project>.json`, then Default.
 * Always overwrite root from the preferred source when present so Setup after UE
 * project-file regen does not leave a stale root copy.
 *
 * Never throws. Distinguishes refreshed vs stale-root-only so Setup can warn when
 * Unreal sources are missing and an old root file would otherwise look like success.
 */
export async function ensureCompileCommands(
    projectPath: string,
    projectName: string
): Promise<CompileCommandsStatus> {
    try {
        const rootCc = path.join(projectPath, 'compile_commands.json');
        const vscodeDir = path.join(projectPath, '.vscode');
        const candidates = [
            path.join(vscodeDir, `compileCommands_${projectName}.json`),
            path.join(vscodeDir, 'compileCommands_Default.json'),
        ];

        for (const src of candidates) {
            if (await fileExists(src)) {
                await fs.copyFile(src, rootCc);
                return 'refreshed';
            }
        }

        if (await fileExists(rootCc)) {
            return 'stale';
        }
        return 'missing';
    } catch {
        return 'error';
    }
}

async function walkRulesFiles(dir: string, results: string[]): Promise<void> {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await walkRulesFiles(full, results);
        } else if (/\.(Build|Target)\.cs$/i.test(entry.name)) {
            results.push(full);
        }
    }
}

/**
 * Discover `*.Build.cs` / `*.Target.cs` under game `Source/` and anywhere under
 * `Plugins/` (including nested layouts like `Plugins/Runtime/MyPlugin/Source`).
 */
export async function discoverProjectRulesFiles(projectPath: string): Promise<string[]> {
    const results: string[] = [];
    await walkRulesFiles(path.join(projectPath, 'Source'), results);
    await walkRulesFiles(path.join(projectPath, 'Plugins'), results);
    return results.sort((a, b) => a.localeCompare(b));
}

function parseEngineVersion(enginePath: string): { major: number; minor: number } | undefined {
    const base = path.basename(enginePath.replace(/[/\\]+$/, ''));
    const m = base.match(/^(?:UE[_-]?)?(\d+)\.(\d+)/i);
    if (!m) {
        return undefined;
    }
    return { major: Number(m[1]), minor: Number(m[2]) };
}

/** Fallback DefineConstants when generated ModuleRules is missing. */
export function buildDefaultDefineConstants(enginePath: string): string {
    const parts = [
        '$(DefineConstants)',
        'WITH_FORWARDED_MODULE_RULES_CTOR',
        'WITH_FORWARDED_TARGET_RULES_CTOR',
    ];

    // Match Unreal's ModuleRules range: UE_4_17_OR_LATER … current engine.
    for (let minor = 17; minor <= 30; minor++) {
        parts.push(`UE_4_${minor}_OR_LATER`);
    }

    // UE_5_N_OR_LATER through the detected engine minor (e.g. UE_5.8 → 0..8).
    // If the path/version cannot be parsed, use a high cap so newer engines still work.
    const ver = parseEngineVersion(enginePath);
    const ue5MaxMinor = ver && ver.major === 5 ? ver.minor : 30;
    for (let minor = 0; minor <= ue5MaxMinor; minor++) {
        parts.push(`UE_5_${minor}_OR_LATER`);
    }
    // UE 6+ installs: also emit UE_6_N_OR_LATER through the detected minor.
    if (ver && ver.major >= 6) {
        for (let major = 6; major <= ver.major; major++) {
            const maxMinor = major === ver.major ? ver.minor : 30;
            for (let minor = 0; minor <= maxMinor; minor++) {
                parts.push(`UE_${major}_${minor}_OR_LATER`);
            }
        }
    }

    return parts.join(';');
}

async function resolveDefineConstants(info: ProjectInfo): Promise<string> {
    const generated = moduleRulesCsproj(info.projectPath, info.projectName);
    if (await fileExists(generated)) {
        const content = await fs.readFile(generated, 'utf8');
        const m = content.match(/<DefineConstants>([^<]*)<\/DefineConstants>/);
        if (m?.[1]?.trim()) {
            return m[1].trim();
        }
    }
    return buildDefaultDefineConstants(info.enginePath);
}

function escapeXmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Write `.vscode/<Project>.BuildRules.IntelliSense.csproj`.
 * References UnrealBuildTool + EpicGames.Build only — NEVER UE5Rules / UE5ProgramRules
 * (those pull thousands of Engine Build.cs files and hang the C# language server).
 */
export async function writeBuildRulesIntelliSenseCsproj(info: ProjectInfo): Promise<{
    csprojPath: string;
    rulesCount: number;
}> {
    const rulesFiles = await discoverProjectRulesFiles(info.projectPath);
    if (rulesFiles.length === 0) {
        throw new Error('No *.Build.cs / *.Target.cs found under Source/ or Plugins/');
    }

    const propsPath = unrealEngineCsprojProps(info.enginePath);
    const ubtPath = unrealBuildToolCsproj(info.enginePath);
    const epicBuildPath = epicGamesBuildCsproj(info.enginePath);

    for (const required of [propsPath, ubtPath, epicBuildPath]) {
        if (!(await fileExists(required))) {
            throw new Error(`Missing engine C# project file: ${required}`);
        }
    }

    const defineConstants = await resolveDefineConstants(info);
    const vscodeDir = path.join(info.projectPath, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });

    const csprojPath = buildRulesIntelliSenseCsproj(info.projectPath, info.projectName);
    const compileItems = rulesFiles
        .map((abs) => {
            const relFromVscode = path.relative(vscodeDir, abs);
            const link = path.relative(info.projectPath, abs);
            return `    <Compile Include="${escapeXmlAttr(relFromVscode)}">
      <Link>${escapeXmlAttr(link)}</Link>
    </Compile>`;
        })
        .join('\n');

    const content = `<!--
  IntelliSense-only Build.cs / Target.cs project for Cursor / VS Code C# extension.
  Generated by ue-vscode-helper. Do NOT point dotnet.defaultSolution at Intermediate
  ModuleRules or the root *.sln — those ProjectReference UE5Rules and hang the C# LS.
  Use the sibling *.BuildRules.IntelliSense.sln as dotnet.defaultSolution.
-->
<Project Sdk="Microsoft.NET.Sdk">
  <Import Project="${escapeXmlAttr(propsPath)}" />
  <PropertyGroup>
    <!-- TargetFramework comes from UnrealEngine.csproj.props (e.g. net10.0 on UE 5.8). -->
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems>
    <IsPackable>false</IsPackable>
    <DefineConstants>${escapeXmlAttr(defineConstants)}</DefineConstants>
    <NoWarn>$(NoWarn);CS1587;CS1591</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${escapeXmlAttr(epicBuildPath)}">
      <Private>false</Private>
    </ProjectReference>
    <ProjectReference Include="${escapeXmlAttr(ubtPath)}">
      <Private>false</Private>
    </ProjectReference>
  </ItemGroup>
  <ItemGroup>
${compileItems}
  </ItemGroup>
</Project>
`;

    await fs.writeFile(csprojPath, content, 'utf8');
    return { csprojPath, rulesCount: rulesFiles.length };
}

/** Stable GUID for the IntelliSense .sln project entry (deterministic per project name). */
function buildRulesIntelliSenseProjectGuid(projectName: string): string {
    const hash = createHash('sha1').update(`ue-vscode-helper:${projectName}:BuildRules.IntelliSense`).digest('hex');
    return `{${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}}`.toUpperCase();
}

/**
 * Write `.vscode/<Project>.BuildRules.IntelliSense.sln` containing ONLY the slim csproj.
 * Cursor's anysphere.csharp is solution-oriented: a root `*.sln` (ModuleRules) wins unless
 * `dotnet.defaultSolution` points at a real .sln.
 */
export async function writeBuildRulesIntelliSenseSln(info: ProjectInfo): Promise<string> {
    const vscodeDir = path.join(info.projectPath, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });

    const csprojName = `${info.projectName}.BuildRules.IntelliSense.csproj`;
    const slnPath = buildRulesIntelliSenseSln(info.projectPath, info.projectName);
    const guid = buildRulesIntelliSenseProjectGuid(info.projectName);

    const content = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${info.projectName}.BuildRules.IntelliSense", "${csprojName}", "${guid}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Release|Any CPU = Release|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		${guid}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		${guid}.Debug|Any CPU.Build.0 = Debug|Any CPU
		${guid}.Release|Any CPU.ActiveCfg = Release|Any CPU
		${guid}.Release|Any CPU.Build.0 = Release|Any CPU
	EndGlobalSection
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
EndGlobal
`;

    await fs.writeFile(slnPath, content, 'utf8');
    return slnPath;
}

function killProcessTree(pid: number | undefined): void {
    if (pid === undefined) {
        return;
    }
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true,
            });
        } else {
            process.kill(-pid, 'SIGKILL');
        }
    } catch {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone
        }
    }
}

function runDotNetRestore(
    dotnetExe: string,
    csproj: string,
    cwd: string,
    timeoutMs: number
): Promise<void> {
    return new Promise((resolve, reject) => {
        // Ignore stdout — only exit code matters for success. Piping stdout without
        // draining can fill the OS pipe buffer and hang restore on large NuGet output.
        // Keep stderr piped (and drained) for truncated failure detail.
        const child = spawn(dotnetExe, ['restore', csproj], {
            cwd,
            env: {
                ...process.env,
                DOTNET_ROOT: path.dirname(dotnetExe),
                DOTNET_MULTILEVEL_LOOKUP: '0',
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
        });

        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
            if (stderr.length > 4000) {
                stderr = stderr.slice(-4000);
            }
        });

        let settled = false;
        let timedOut = false;
        let exitGrace: ReturnType<typeof setTimeout> | undefined;
        const timeoutError = () =>
            new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
        const finish = (err?: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (exitGrace !== undefined) {
                clearTimeout(exitGrace);
            }
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        };

        // PR valid: "Restore timeout may leave dotnet running".
        // After kill: wait for child close (or grace) before finishing — sync taskkill
        // stays fire-and-forget (do NOT await-taskkill Promise — undone bounce).
        // Once timedOut, ALWAYS reject timeout — never resolve success after kill
        // (that flip-flop caused "treats killed run as success"). Intentional.
        const timer = setTimeout(() => {
            timedOut = true;
            killProcessTree(child.pid);
            exitGrace = setTimeout(() => finish(timeoutError()), 8_000);
        }, timeoutMs);

        child.on('error', (err) => finish(err));
        child.on('close', (code, signal) => {
            if (timedOut) {
                finish(timeoutError());
                return;
            }
            if (code === 0) {
                finish();
                return;
            }
            const detail = stderr.trim() || signal || `exit ${code}`;
            finish(new Error(detail));
        });
    });
}

/**
 * Run UE-bundled `dotnet restore` on the slim BuildRules IntelliSense csproj (non-fatal).
 * Always returns within `timeoutMs` (default 90s); caller should write C# settings first.
 */
export async function restoreBuildRulesIntelliSense(
    info: ProjectInfo,
    timeoutMs: number = BUILD_RULES_RESTORE_TIMEOUT_MS
): Promise<string | undefined> {
    const enabled = await getHelperSetting<boolean>(info.projectPath, 'restoreModuleRules', true);
    if (!enabled) {
        return 'BuildRules IntelliSense restore skipped (ue-vscode-helper.restoreModuleRules is false).';
    }

    const csproj = buildRulesIntelliSenseCsproj(info.projectPath, info.projectName);
    if (!(await fileExists(csproj))) {
        return 'Slim BuildRules IntelliSense .csproj not found (Setup should have written it).';
    }

    const dotNetDir = await findUeDotNetPath(info.enginePath);
    if (!dotNetDir) {
        return 'UE-bundled DotNet not found — skipped BuildRules IntelliSense restore.';
    }

    const dotnetExe = path.join(dotNetDir.replace(/\//g, path.sep), 'dotnet.exe');
    try {
        await runDotNetRestore(dotnetExe, csproj, info.projectPath, timeoutMs);
        return undefined;
    } catch (err: unknown) {
        return `BuildRules IntelliSense restore failed: ${(err as Error).message}`;
    }
}

/** @deprecated Prefer restoreBuildRulesIntelliSense */
export async function restoreModuleRules(
    info: ProjectInfo,
    timeoutMs: number = BUILD_RULES_RESTORE_TIMEOUT_MS
): Promise<string | undefined> {
    return restoreBuildRulesIntelliSense(info, timeoutMs);
}

/**
 * Write `.clangd` + refresh root compile_commands AFTER hard Setup commits.
 * Never throws — failures become notes so Setup can still succeed / Reload.
 */
export async function writeCursorSecondaryArtifacts(info: ProjectInfo): Promise<string[]> {
    const notes: string[] = [];
    try {
        await writeClangdConfig(info.projectPath);
    } catch (err: unknown) {
        notes.push(`Warning: could not write .clangd — ${(err as Error).message}`);
    }

    const cc = await ensureCompileCommands(info.projectPath, info.projectName);
    if (cc === 'refreshed') {
        // quiet success
    } else if (cc === 'stale') {
        notes.push(
            'Root compile_commands.json exists but .vscode/compileCommands_*.json is missing — ' +
                'clangd may be using a stale database. Generate VS Code project files in Unreal, then re-run Setup.'
        );
    } else if (cc === 'missing') {
        notes.push(
            'No compile_commands.json found — generate VS Code project files in Unreal, then re-run Setup.'
        );
    } else {
        notes.push(
            'compile_commands.json could not be refreshed — generate VS Code project files in Unreal, then re-run Setup.'
        );
    }
    return notes;
}
