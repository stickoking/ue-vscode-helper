# Unreal Engine VS Code / Cursor Helper

**One-click Unreal IntelliSense setup for both VS Code and Cursor**, plus engine excludes and optional Git init.

The extension auto-detects the host editor and applies the matching profile:

| Host | IntelliSense profile |
|------|----------------------|
| **Cursor** | clangd + disable Microsoft C++ IntelliSense + slim BuildRules IntelliSense csproj/sln |
| **VS Code** | Microsoft C++ via `c_cpp_properties.json` (clangd left off; no `.clangd` suppress-all) |

## Features

- **Host-aware setup** — Detects Cursor vs VS Code (`preferHost` can force either)
- **Cursor profile** — Enables clangd, writes `.clangd`, ensures root `compile_commands.json`, writes a **slim** BuildRules IntelliSense `.csproj` + `.sln` (no UE5Rules), optional UE `dotnet restore`
- **VS Code profile** — Patches `c_cpp_properties.json` with compileCommands, forced includes, and include paths
- **Performance** — Shared excludes for Engine / Intermediate / Saved / etc. in `.code-workspace` **and** `.vscode/settings.json`
- **Engine path** — Reads `EngineAssociation` from `.uproject` when possible; falls back to `ue-vscode-helper.enginePath`
- **Git Init (optional)** — Unreal `.gitignore`, initial commit, optional remote
- Idempotent — safe to re-run after Unreal “Generate VS Code project files” (which often resets workspace settings)

## How to Use

1. In Unreal Editor: **Generate Visual Studio Code Project Files**
2. Open the project folder (or `.code-workspace`) in **VS Code** or **Cursor**
3. `Ctrl+Shift+P` → **Unreal: Setup IntelliSense + Excludes**
4. Reload the window when prompted

Optional: **Unreal: Init Git + .gitignore**

### Cursor-specific

1. Install the [clangd](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd) extension (`llvm-vs-code-extensions.vscode-clangd`). Setup will hint if it is missing.
2. After setup you should have:
   - `clangd.enable: true` and Microsoft C++ IntelliSense / autocomplete / squiggles / formatting disabled
   - Project `.clangd` with `CompilationDatabase: .` — **project Source diagnostics enabled** (Unused/Missing includes only muted); Engine paths still fully suppressed + index skipped
   - Root `compile_commands.json` (copied from `.vscode` if needed)
   - `dotnet.defaultSolution` → `.vscode/<Project>.BuildRules.IntelliSense.sln` (slim csproj only — **not** root `*.sln` / Intermediate ModuleRules / UE5Rules) plus UE-bundled `dotnet.dotnetPath`
   - Excludes mirrored into both `.code-workspace` and `.vscode/settings.json`
3. If hover / go-to-definition dies after regenerating project files, Unreal likely reset `.code-workspace` — run **Setup** again.
4. Why not Intermediate ModuleRules / root `*.sln`? That generated project references **UE5Rules** (~2500 Engine Build.cs files). Cursor’s C# extension prefers `.sln` over `.csproj` for `dotnet.defaultSolution`; a root ModuleRules `.sln` auto-loads and hangs. The slim `.sln`+`.csproj` avoid that.
5. After Setup: **Developer: Reload Window**, open a `*.Build.cs`, confirm status bar shows the slim solution (not ModuleRules). If still “Miscellaneous Files”, run **.NET: Open Solution** and pick `.vscode/<Project>.BuildRules.IntelliSense.sln`.
6. **Never open the root Unreal `*.sln` for C# IntelliSense** — it loads ModuleRules → UE5Rules and hangs. Re-run **Setup** after Unreal “Generate VS Code project files” (that often resets `.code-workspace` / settings).

### Install from VSIX (Cursor)

```bash
npm run package
npm run vsix
cursor --install-extension ue-vscode-helper-0.2.7.vsix
```

Same VSIX works in VS Code via `code --install-extension ue-vscode-helper-0.2.7.vsix`.

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ue-vscode-helper.enginePath` | `C:\Program Files\Epic Games\UE_5.4` | Fallback engine path if `.uproject` association cannot be resolved |
| `ue-vscode-helper.preferHost` | `auto` | `auto` \| `cursor` \| `vscode` — force IntelliSense profile |
| `ue-vscode-helper.restoreModuleRules` | `true` | Cursor: run UE `dotnet restore` on the **slim** BuildRules IntelliSense csproj (90s timeout, non-fatal) |

## Requirements

- Unreal Engine 5.4+ (Windows-focused)
- “Generate Visual Studio Code Project Files” already run
- **Cursor:** clangd extension recommended
- **VS Code:** Microsoft C/C++ extension (usual Unreal toolchain)
- Git (only for the Git init command)

## Known Issues

- Definitions.`*.h` must exist for the VS Code profile (open/build the project once after generating files)
- Slim BuildRules restore is skipped (non-fatal) if the csproj write failed, times out (90s), or is disabled — C# settings are still written; re-run Setup if needed
- Slim IntelliSense does not compile against every Engine module’s Build.cs (by design). You get UBT APIs (`ModuleRules`, `TargetRules`, etc.); cross-references into Engine `*.Build.cs` files won’t resolve
- Works best on Windows

## Release Notes

### 0.2.7

- Cursor rule + skill documenting architecture and pitfalls (slim IntelliSense `.sln`, no project-wide clangd `Suppress "*"`, re-run Setup after UE regen)

### 0.2.6

- Slim `.sln` wrapper + `dotnet.defaultSolution` must be `.sln` (not `.csproj`) so Cursor C# does not auto-load root ModuleRules → UE5Rules

### 0.2.5

- Slim `.vscode/<Project>.BuildRules.IntelliSense.csproj` for Build.cs / Target.cs (no UE5Rules); fixes forever-loading ModuleRules / “Miscellaneous Files”

### 0.2.4

- Always show Reload Window prompt after successful Setup

### 0.2.3

- Cursor `.clangd`: diagnostics enabled for project Source; Engine still suppressed; C# IntelliSense documented as part of the locked-in Cursor profile
- VS Code profile continues to leave Microsoft C++ alone (no clangd suppress-all)

### 0.2.2

- Cursor `.clangd`: stop suppressing all diagnostics in project Source (real syntax errors show again); Engine paths still fully suppressed

### 0.2.1

- Clear progress steps; ModuleRules restore no longer blocks “Patching excludes & settings…”
- 90s restore timeout + `restoreModuleRules` setting; C# ModuleRules settings always written first

### 0.2.0

- Dual-host: Cursor (clangd) vs VS Code (Microsoft C++) profiles
- `preferHost` setting; engine path from `.uproject` `EngineAssociation`
- Mirror settings to `.vscode/settings.json`; write `.clangd`; ModuleRules restore hint

### 0.1.x

- IntelliSense + excludes patching and Git init for VS Code

---

Feedback / issues welcome on GitHub.
