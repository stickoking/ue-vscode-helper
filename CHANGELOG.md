# Change Log

All notable changes to the "ue-vscode-helper" extension will be documented in this file.

## [1.1.0] - 2026-07-18

Marketplace release consolidating develop work since 1.0.x (internal 0.2.x–0.3.x).

### Added
- **Dual-host IntelliSense**: auto-detect Cursor vs VS Code (`ue-vscode-helper.preferHost`); Cursor uses clangd + disable Microsoft/Anysphere C++ IntelliSense; VS Code keeps Microsoft C++ via `c_cpp_properties.json`
- **Ensure extensions** (`src/extensions.ts`): soft Install/Dismiss for missing host extensions **before** profile/config patch; awaits installs; marketplace search fallback; never hard-fails Setup
- Settings `ue-vscode-helper.ensureExtensions` (`required` \| `requiredAndOptional` \| `off`, default **requiredAndOptional**) and `ue-vscode-helper.promptPython` (default **true**)
- Host matrices: Cursor required clangd + `anysphere.csharp`; optional .NET runtime + `anysphere.cpptools` + Python; VS Code required `ms-vscode.cpptools` + `ms-dotnettools.csharp`; optional csdevkit / .NET runtime / Python / CMake Tools
- Rewrites `.code-workspace` `extensions.recommendations` (host-aware); marks `ms-vscode.cpptools` as unwanted on Cursor; clears those unwanted IDs on VS Code after a prior Cursor Setup
- Slim `.vscode/<Project>.BuildRules.IntelliSense.csproj` + sibling `.sln` for Build.cs / Target.cs IntelliSense (no UE5Rules); `dotnet.defaultSolution` must point at the **`.sln`**
- Engine path from `.uproject` `EngineAssociation`; mirror excludes/settings to `.code-workspace` and `.vscode/settings.json`; write `.clangd` + root `compile_commands.json` on Cursor
- Git init command retained (Unreal `.gitignore`, confirmation guards)

### Fixed
- Setup validates workspace / `.vscode/settings.json` JSONC **before** `getHelperSetting` / ensure-extensions; invalid project settings throw (no silent fallback)
- BuildRules `dotnet restore` on timeout: sync process-tree kill, then wait for child exit (or short grace) before reporting timeout; once kill was requested, result is always timeout (never success-after-kill flip-flop)
- Git init skips engine/helper settings resolve (`resolveEngine: false`) so invalid settings JSONC cannot block init
- Hard-phase `patchVscodeSettings` no longer replaces a corrupt settings file with `{}` — parse failure throws and rolls back with the hard transaction (settings JSONC family)
- Soft phase after hard commit is isolated: restore/`getHelperSetting` (or other soft errors) become warnings; Setup still succeeds and offers Reload (soft-phase family — not soft-catch inside `restoreBuildRulesIntelliSense`)
- Extension install waits until `getExtension` sees a satisfying id (`satisfiedBy` aware); outcomes are visible / pending (Reload may be needed) / failed (marketplace search) — no false “opened search” after a successful install command
- Publish workflow: Open VSX and Marketplace both run even if the other fails (`continue-on-error`); job fails afterward if any attempted publish failed
- Cursor `.clangd` no longer sets project-wide `Diagnostics.Suppress: ["*"]` — real C++ error squiggles show again; Engine PathMatch still fully suppressed
- BuildRules IntelliSense `dotnet restore` no longer pipes undrained stdout (large NuGet output could fill the pipe and hang); stdout ignored, stderr drained for failure detail; 90s timeout + process-tree kill
- VS Code Python checklist no longer treats Cursor-only `anysphere.cursorpyright` as satisfying Python; Cursor path still accepts cursorpyright **or** `ms-python.python`
- Setup progress / Reload Window UX: dialogs outside `withProgress`; always prompt Reload after success; restore timeout non-fatal
- Slim BuildRules: set `dotnet.defaultSolution` only after csproj+sln succeed; on failure restore each file to its pre-write snapshot (no orphan half-state); keep the pointer only when a complete prior pair is verified
- Always refresh root `compile_commands.json` from `.vscode/compileCommands_*` when the source exists
- Pick highest UE-bundled DotNet version folder with numeric sort (`10.0` over `9.0`); clear stale `dotnet.dotnetPath` / terminal `DOTNET_*` when DotNet is missing
- `UE_5_N_OR_LATER` DefineConstants through the detected engine minor (not a hard cap at 20)
- Exclude merge drops only **helper-managed** absolute engine suffixes when `enginePath` changes (not broad Epic/UE_ regex); relative globs preserved — see Intentional below
- Resolve `.code-workspace` by `.uproject` `projectName`, then folder basename
- Setup preflights workspace/settings JSONC only (**not** `c_cpp_properties` — soft-fail in hard phase; `3372ae7`)
- `findProjectInfo` uses `dirname(.uproject)`; multi-`.uproject` → active-editor / remembered / QuickPick (never arbitrary first match)
- Git init uses the same `.uproject` root as Setup; remote add via `execFile` + URL validation
- VS Code profile re-enables `C_Cpp.*`, clears Cursor-only `dotnet.*` / `omnisharp.*` / terminal `DOTNET_*`, requires real `compilerPath`, and uses absolute `<uproject>/Source` (not `${workspaceFolder}/Source`)
- Slim BuildRules discovers `*.Build.cs` / `*.Target.cs` under game `Source/` and all of `Plugins/` (including nested plugin layouts)
- `ensureCompileCommands` never throws on copy/IO failure — Setup continues after `.clangd` / BuildRules writes (soft note instead of abort)
- VS Code Setup always applies host-cleanup settings / recommendations even when `c_cpp_properties` cannot be patched (soft warning instead of leaving Cursor leftovers)
- Preflight/settings/workspace reads accept JSONC (comments + trailing commas)
- Hard Setup phase uses one `HardDiskTransaction`: snapshot settings/workspace/(Cursor BuildRules)/(VS Code c_cpp_properties) BEFORE writes; any hard-path failure rolls them all back together (checked). Soft phase (clangd / compile_commands / restore) runs only after hard commit
- VS Code `c_cpp_properties.json` remains fully supported (hard phase after settings; soft note + props-only rollback if UE-generated file missing)
- Removed dead/redundant `applyCursorProfile` / `applyVsCodeProfile` / duplicate snapshot helpers (Setup owns the transaction)
- `ensureCompileCommands` reports `refreshed` | `stale` | `missing` | `error` — stale root without `.vscode/compileCommands_*` warns instead of silent success

### Intentional (invalid Bugbot “fixes” — do not reverse)

Documented in `.cursor/rules/intentional-designs.mdc` so agents/Bugbot do not flip-flop:

- **Helper-managed exclude suffixes** (`59f2807`): only drop absolute keys ending in known Engine helper suffixes. Not “suffix too broad → stop dropping”; not broad Epic/UE_ strip.
- **Game `.vscode/settings.json` for helper keys** (`59f2807`): preferred over first-folder `getConfiguration` / workspace-only reads. Not “stale .vscode overrides workspace → prefer `.code-workspace`”.
- **`ensureExtensions` vs workspace recommendations**: mode controls Install **prompts**; recommendations still list host optionals for discovery — different knobs.
- **clangd Engine PathMatch** (`59f2807`): project diagnostics on; Engine PathMatch Suppress+Skip. Do not thrash PathMatch for Bugbot breadth complaints.
- **Restore after kill**: once timeout kill is requested, outcome is timeout after wait — never “success if exit 0 after kill”.
- **Soft phase after hard commit**: clangd / compile_commands / restore failures are notes only; Setup still succeeds (catch at soft call site in `extension.ts`, not inside restore’s `getHelperSetting`).
- **No `c_cpp_properties` preflight** (`3372ae7`): soft-fail in hard phase only.

### Changed
- Setup order locked: **extensions → config patch → single Reload Window**
- Display name / description: Unreal Engine VS Code / Cursor Helper

## [0.3.0] - 2026-07-18

### Added
- **Ensure extensions** (`src/extensions.ts`): soft Install/Dismiss for missing host extensions **before** profile/config patch; awaits installs; marketplace search fallback; never hard-fails Setup
- Settings `ue-vscode-helper.ensureExtensions` (`required` \| `requiredAndOptional` \| `off`, default **requiredAndOptional**) and `ue-vscode-helper.promptPython` (default **true**)
- Host matrices: Cursor required clangd + `anysphere.csharp`; optional .NET runtime + `anysphere.cpptools` + Python; VS Code required `ms-vscode.cpptools` + `ms-dotnettools.csharp`; optional csdevkit / .NET runtime / Python / CMake Tools
- Rewrites `.code-workspace` `extensions.recommendations` (host-aware); marks `ms-vscode.cpptools` as unwanted on Cursor

### Changed
- Setup order locked: **extensions → config patch → single Reload Window**
- Removed standalone `hintClangdExtension` (folded into ensure-extensions)
- Skill/rule/README mark ensure-extensions as **IMPLEMENTED**

## [0.2.7] - 2026-07-17

### Added
- Cursor project rule (`.cursor/rules/ue-vscode-helper.mdc`, alwaysApply) and skill (`.cursor/skills/ue-helper/SKILL.md`) documenting dual-host architecture, clangd pitfalls, and slim BuildRules IntelliSense `.sln` / `defaultSolution` requirements so cold agents do not regress

### Docs
- Expanded skill + always-apply rule: official vs reality, Cursor/VS Code extension stacks, version lessons through 0.2.7, hard agent rules, and **planned** ensure-extensions design (extensions → configs → one Reload; host matrices; settings). Docs only — no ensure-extensions implementation yet.

### Confirmed
- Setup already writes slim `.csproj` + `.sln`, sets `dotnet.defaultSolution` to the **`.sln`**, restores with timeout, and prompts Reload Window (0.2.6 behavior unchanged)

## [0.2.6] - 2026-07-17

### Fixed
- **0.2.5 slim csproj alone was not enough**: Cursor’s `anysphere.csharp` is solution-oriented. Pointing `dotnet.defaultSolution` at a `.csproj` is ignored; the root `*.sln` (ObstacleAssaultModuleRules → **UE5Rules**) still auto-loads, so Build.cs stayed forever-loading / “Miscellaneous Files”.
- Setup now also writes `.vscode/<Project>.BuildRules.IntelliSense.sln` (slim csproj only) and sets `dotnet.defaultSolution` to that **.sln**.

## [0.2.5] - 2026-07-17

### Fixed
- **Build.cs / Target.cs IntelliSense hung forever** because `dotnet.defaultSolution` pointed at Unreal’s generated `*ModuleRules.csproj`, which ProjectReferences **UE5Rules** + **UE5ProgramRules** (~2500+ Engine Build.cs files). The C# language server never finished loading, so Source Build.cs stayed “Miscellaneous Files” with no Ctrl+click / completion.
- Cursor Setup now writes a **slim** `.vscode/<Project>.BuildRules.IntelliSense.csproj` (game `*.Build.cs` / `*.Target.cs` only + UnrealBuildTool / EpicGames.Build — **no** UE5Rules), points `dotnet.defaultSolution` at it, and restores that project instead of Intermediate ModuleRules.

### Changed
- Setting `ue-vscode-helper.restoreModuleRules` still gates restore, but now restores the slim IntelliSense csproj (description updated)

## [0.2.4] - 2026-07-17

### Fixed
- Setup always shows a **Reload Window** / **Later** prompt after success (outside `withProgress`); previously a buttonless success toast could finish the flow without asking to reload for IntelliSense settings

## [0.2.3] - 2026-07-17

### Fixed / Documented
- Cursor `.clangd` template matches ObstacleAssault exactly: project Source keeps real diagnostics (UnusedIncludes/MissingIncludes only set to None); **no** project-wide `Suppress: ["*"]`
- Engine PathMatch still `Suppress: ["*"]` + `Index.Background: Skip`
- Cursor profile checklist locked in: clangd on, C_Cpp IntelliSense/autocomplete/errorSquiggles/formatting off, ModuleRules `dotnet.defaultSolution` + UE `dotnet.dotnetPath`, openFiles analysis scope, excludes mirrored to `.code-workspace` + `.vscode/settings.json`, root `compile_commands.json`, ModuleRules restore (90s timeout), progress UX (dialogs outside `withProgress`), `preferHost` / Cursor detection
- VS Code profile still does **not** write `.clangd` or force clangd suppress-all; keeps Microsoft C++ path

## [0.2.2] - 2026-07-17

### Fixed
- Cursor `.clangd` no longer sets `Diagnostics.Suppress: ["*"]` for project Source — that hid **all** red squiggles (including real syntax errors). Engine PathMatch still suppresses everything + skips background index.

## [0.2.1] - 2026-07-17

### Fixed
- Setup no longer appears stuck on **Patching excludes & settings...**: reload/success prompts ran *inside* `withProgress`, so that last progress label stayed up until the user dismissed the dialog; ModuleRules `dotnet restore` also ran earlier under a coarse profile step and could take a long time
- Split progress into clear steps: clangd / compile_commands → patch excludes & settings → ModuleRules restore
- ModuleRules restore is hard-capped at **90s** (process-tree kill on Windows); setup always continues and shows success/failure + reload
- C# ModuleRules settings (`dotnet.defaultSolution`, `dotnet.dotnetPath`, openFiles analysis scope) are written **before** restore, so they apply even if restore is skipped/fails
- Clangd install / reload prompts run after progress closes (no nested modal under the progress notification)

### Added
- Setting `ue-vscode-helper.restoreModuleRules` (default `true`) to skip restore entirely

## [0.2.0] - 2026-07-17

### Added
- Dual-host IntelliSense: auto-detect Cursor vs VS Code (`ue-vscode-helper.preferHost`)
- Cursor profile: clangd settings, disable C_Cpp IntelliSense, ModuleRules `dotnet` path, `.clangd`, root `compile_commands.json`, optional UE `dotnet restore`
- Soft prompt to install `llvm-vs-code-extensions.vscode-clangd` when missing on Cursor
- Resolve engine path from `.uproject` `EngineAssociation` with setting fallback
- Mirror critical settings into `.vscode/settings.json` as well as `.code-workspace`

### Changed
- Command title: **Unreal: Setup IntelliSense + Excludes**
- Display name / description cover both VS Code and Cursor
- Refactored into host / engine / excludes / profiles / git modules

## [1.0.1] - 2026-06-22

### Added
- Fixed TypeScript errors and updated type definitions for test suite
- Updated dependencies to address package vulnerabilities
- Quality of life improvements

## [1.0.0] - 2026-03-01

### Added
- Full IntelliSense + excludes patching
- Added strong Git init guards with confirmation dialogs
- Clean native TypeScript implementation
