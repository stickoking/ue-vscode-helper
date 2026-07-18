# Change Log

All notable changes to the "ue-vscode-helper" extension will be documented in this file.

## [1.1.0] - 2026-07-18

Marketplace release consolidating develop work since 1.0.x (internal 0.2.x–0.3.x).

### Added
- **Dual-host IntelliSense**: auto-detect Cursor vs VS Code (`ue-vscode-helper.preferHost`); Cursor uses clangd + disable Microsoft/Anysphere C++ IntelliSense; VS Code keeps Microsoft C++ via `c_cpp_properties.json`
- **Ensure extensions** (`src/extensions.ts`): soft Install/Dismiss for missing host extensions **before** profile/config patch; awaits installs; marketplace search fallback; never hard-fails Setup
- Settings `ue-vscode-helper.ensureExtensions` (`required` \| `requiredAndOptional` \| `off`, default **requiredAndOptional**) and `ue-vscode-helper.promptPython` (default **true**)
- Host matrices: Cursor required clangd + `anysphere.csharp`; optional .NET runtime + `anysphere.cpptools` + Python; VS Code required `ms-vscode.cpptools` + `ms-dotnettools.csharp`; optional csdevkit / .NET runtime / Python / CMake Tools
- Rewrites `.code-workspace` `extensions.recommendations` (host-aware); marks `ms-vscode.cpptools` as unwanted on Cursor
- Slim `.vscode/<Project>.BuildRules.IntelliSense.csproj` + sibling `.sln` for Build.cs / Target.cs IntelliSense (no UE5Rules); `dotnet.defaultSolution` must point at the **`.sln`**
- Engine path from `.uproject` `EngineAssociation`; mirror excludes/settings to `.code-workspace` and `.vscode/settings.json`; write `.clangd` + root `compile_commands.json` on Cursor
- Git init command retained (Unreal `.gitignore`, confirmation guards)

### Fixed
- Cursor `.clangd` no longer sets project-wide `Diagnostics.Suppress: ["*"]` — real C++ error squiggles show again; Engine PathMatch still fully suppressed
- BuildRules IntelliSense `dotnet restore` no longer pipes undrained stdout (large NuGet output could fill the pipe and hang); stdout ignored, stderr drained for failure detail; 90s timeout + process-tree kill unchanged
- VS Code Python checklist no longer treats Cursor-only `anysphere.cursorpyright` as satisfying Python; Cursor path still accepts cursorpyright **or** `ms-python.python`
- Setup progress / Reload Window UX: dialogs outside `withProgress`; always prompt Reload after success; restore timeout non-fatal

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
