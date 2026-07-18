import * as path from 'path';
import { ProjectInfo } from '../engine';
import { fileExists, readJson, writeJson, normalizeSlashes } from '../util';

/** Pull a non-empty compilerPath from any existing c_cpp_properties configuration. */
export function extractCompilerPath(props: { configurations?: unknown }): string | undefined {
    const configs = Array.isArray(props.configurations) ? props.configurations : [];
    for (const cfg of configs) {
        if (
            cfg &&
            typeof cfg === 'object' &&
            typeof (cfg as { compilerPath?: unknown }).compilerPath === 'string'
        ) {
            const value = ((cfg as { compilerPath: string }).compilerPath || '').trim();
            if (value) {
                return value;
            }
        }
    }
    return undefined;
}

/**
 * VS Code profile: patch c_cpp_properties.json for Microsoft C++ IntelliSense.
 * Called from Setup's hard phase after settings are written (still fully supported).
 * Does not enable clangd, does not write `.clangd`, and does not disable C_Cpp.
 * Never force Diagnostics.Suppress "*" — that belongs only to Cursor Engine PathMatch.
 */
export async function patchCppProperties(info: ProjectInfo): Promise<void> {
    const { projectPath, enginePath, projectName } = info;
    const vscodeDir = path.join(projectPath, '.vscode');
    const propsFile = path.join(vscodeDir, 'c_cpp_properties.json');

    if (!(await fileExists(propsFile))) {
        throw new Error('c_cpp_properties.json not found. Generate project files in UE first!');
    }

    const props = await readJson<any>(propsFile);

    // Require a real compilerPath — writing undefined makes MS C++ fail silently.
    const compilerPath = extractCompilerPath(props);
    if (!compilerPath) {
        throw new Error(
            'c_cpp_properties.json has no compilerPath. Generate VS Code project files in Unreal first, then re-run Setup.'
        );
    }

    let compileCommands = path.join(vscodeDir, `compileCommands_${projectName}.json`);
    if (!(await fileExists(compileCommands))) {
        compileCommands = path.join(vscodeDir, 'compileCommands_Default.json');
    }
    if (!(await fileExists(compileCommands))) {
        throw new Error(
            'No compileCommands_*.json found under .vscode. Generate VS Code project files in Unreal first!'
        );
    }

    const definitionsHeader = normalizeSlashes(
        path.join(
            projectPath,
            'Intermediate',
            'Build',
            'Win64',
            'x64',
            'UnrealEditor',
            'Development',
            projectName,
            `Definitions.${projectName}.h`
        )
    );
    const sharedDefsDir = normalizeSlashes(
        path.join(
            projectPath,
            'Intermediate',
            'Build',
            'Win64',
            'x64',
            `${projectName}Editor`,
            'Development',
            'UnrealEd'
        )
    );

    const projectNorm = normalizeSlashes(projectPath);
    const engineNorm = normalizeSlashes(enginePath);

    const newConfig = {
        name: `${projectName}Editor Win64 Development`,
        compilerPath,
        cStandard: 'c17',
        cppStandard: 'c++20',
        intelliSenseMode: 'msvc-x64',
        compileCommands: normalizeSlashes(compileCommands),
        includePath: [
            // Absolute uproject Source — NOT ${workspaceFolder}/Source (wrong in monorepos).
            `${projectNorm}/Source`,
            `${projectNorm}/Intermediate/Build/Win64/UnrealEditor/Inc/${projectName}/UHT`,
            sharedDefsDir,
            `${engineNorm}/Engine/Intermediate/Build/Win64/UnrealEditor/Inc/**`,
            `${engineNorm}/Engine/Intermediate/Build/Win64/UnrealGame/Inc/**`,
            `${engineNorm}/Engine/Source/**`,
        ],
        forcedInclude: [definitionsHeader],
    };

    await writeJson(propsFile, { configurations: [newConfig], version: 4 });
}

/**
 * VS Code profile settings: keep Microsoft C++ as default; do not force clangd.on.
 * Explicitly re-enable C_Cpp after a prior Cursor setup (which sets them to disabled);
 * otherwise deep-merge would leave Microsoft IntelliSense off.
 * Clear Cursor-only clangd/dotnet/omnisharp/terminal keys left by a prior Cursor Setup
 * (undefined → mergeSettings deletes).
 *
 * `c_cpp_properties.json` is patched by `patchCppProperties` during Setup hard phase.
 */
export function buildVsCodeSettings(): Record<string, any> {
    return {
        'clangd.enable': false,
        'clangd.arguments': undefined,
        'C_Cpp.intelliSenseEngine': 'default',
        'C_Cpp.autocomplete': 'default',
        'C_Cpp.errorSquiggles': 'enabled',
        'C_Cpp.formatting': 'default',
        'dotnet.dotnetPath': undefined,
        'dotnet.defaultSolution': undefined,
        'dotnet.backgroundAnalysis.compilerDiagnosticsScope': undefined,
        'dotnet.backgroundAnalysis.analyzerDiagnosticsScope': undefined,
        'omnisharp.projectLoadTimeout': undefined,
        'omnisharp.enableRoslynAnalyzers': undefined,
        'omnisharp.enableEditorConfigSupport': undefined,
        'terminal.integrated.env.windows': {
            PATH: undefined,
            DOTNET_ROOT: undefined,
            DOTNET_HOST_PATH: undefined,
            DOTNET_MULTILEVEL_LOOKUP: undefined,
            DOTNET_ROLL_FORWARD: undefined,
        },
    };
}
