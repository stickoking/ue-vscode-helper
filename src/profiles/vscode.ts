import * as path from 'path';
import { ProjectInfo } from '../engine';
import { fileExists, readJson, writeJson, normalizeSlashes } from '../util';

/**
 * VS Code profile: patch c_cpp_properties.json for Microsoft C++ IntelliSense.
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
    let compileCommands = path.join(vscodeDir, `compileCommands_${projectName}.json`);
    if (!(await fileExists(compileCommands))) {
        compileCommands = path.join(vscodeDir, 'compileCommands_Default.json');
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
    const compilerPath = props.configurations?.[0]?.compilerPath;

    const newConfig = {
        name: `${projectName}Editor Win64 Development`,
        compilerPath,
        cStandard: 'c17',
        cppStandard: 'c++20',
        intelliSenseMode: 'msvc-x64',
        compileCommands: normalizeSlashes(compileCommands),
        includePath: [
            '${workspaceFolder}/Source',
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
 */
export function buildVsCodeSettings(): Record<string, any> {
    return {
        'clangd.enable': false,
        'C_Cpp.intelliSenseEngine': 'default',
        'C_Cpp.autocomplete': 'default',
        'C_Cpp.errorSquiggles': 'enabled',
        'C_Cpp.formatting': 'default',
    };
}

export async function applyVsCodeProfile(info: ProjectInfo): Promise<{
    settings: Record<string, any>;
    notes: string[];
}> {
    await patchCppProperties(info);
    return {
        settings: buildVsCodeSettings(),
        notes: [],
    };
}
