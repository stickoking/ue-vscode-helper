# Unreal Engine VS Code / Cursor Helper

**One-click Unreal IntelliSense setup for both VS Code and Cursor**, plus engine excludes and optional Git init.

The extension auto-detects the host editor and applies the matching profile:

| Host | IntelliSense profile |
|------|----------------------|
| **Cursor** | clangd + disable Microsoft C++ IntelliSense + slim BuildRules IntelliSense csproj/sln |
| **VS Code** | Microsoft C++ via `c_cpp_properties.json` (clangd left off; no `.clangd` suppress-all) |

## Features

- **Host-aware setup** — Detects Cursor vs VS Code (`preferHost` can force either)
- **Ensure extensions** — Soft-prompts missing host extensions **before** config patch (Install / Dismiss; never hard-fails). Rewrites `.code-workspace` `extensions.recommendations`
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
4. If prompted, Install missing extensions (or Dismiss — Setup continues)
5. Reload the window when prompted

Optional: **Unreal: Init Git + .gitignore**

Setup order is locked: **extensions → config patch → single Reload Window**. Extensions run first so first-install defaults cannot overwrite helper settings.

### Cursor-specific

1. Setup ensures **clangd** (`llvm-vs-code-extensions.vscode-clangd`) and **C# (Cursor)** (`anysphere.csharp`). Optional (default): .NET Install Tool, Cursor C/C++ (debug only), Python (Cursor Pyright or `ms-python.python`). **Never** installs/recommends `ms-vscode.cpptools` on Cursor.
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
cursor --install-extension ue-vscode-helper-1.1.0.vsix
```

Same VSIX works in VS Code via `code --install-extension ue-vscode-helper-1.1.0.vsix`.

> **CLI deprecation noise (harmless):** `cursor --install-extension` may print Node `[DEP0040] punycode` and/or `[DEP0169] url.parse()` warnings. Those come from **Cursor’s host CLI** (`resources/app/out/cli.js` / `cliProcessMain.js` → bundled `node-fetch` / `whatwg-url`), not from this extension. The VSIX has no runtime deps and no `punycode`/`url.parse` usage. The same install still reports success; VS Code’s `code` CLI can show `url.parse` noise too. **Not a marketplace blocker** and not fixable inside this repo.

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ue-vscode-helper.enginePath` | `C:\Program Files\Epic Games\UE_5.4` | Fallback engine path if `.uproject` association cannot be resolved |
| `ue-vscode-helper.preferHost` | `auto` | `auto` \| `cursor` \| `vscode` — force IntelliSense profile |
| `ue-vscode-helper.restoreModuleRules` | `true` | Cursor: run UE `dotnet restore` on the **slim** BuildRules IntelliSense csproj (90s timeout, non-fatal) |
| `ue-vscode-helper.ensureExtensions` | `requiredAndOptional` | `required` \| `requiredAndOptional` \| `off` — soft-prompt host extensions before config patch |
| `ue-vscode-helper.promptPython` | `true` | Include Python in the checklist (even on `required`); either Cursor Pyright or `ms-python.python` satisfies |

## Agent / contributor notes

Cold agents working on this repo: read **`.cursor/skills/ue-helper/SKILL.md`** (full knowledge base) and the always-apply rule **`.cursor/rules/ue-vscode-helper.mdc`**. Covers clangd Suppress pitfalls, slim BuildRules `.sln` / `defaultSolution`, host stacks, and the **implemented** ensure-extensions feature.

## Requirements

- Unreal Engine 5.4+ (Windows-focused)
- “Generate Visual Studio Code Project Files” already run
- **Cursor:** clangd + Cursor C# (Setup can install)
- **VS Code:** Microsoft C/C++ + C# (Setup can install)
- Git (only for the Git init command)

## Known Issues

- Definitions.`*.h` must exist for the VS Code profile (open/build the project once after generating files)
- Slim BuildRules restore is skipped (non-fatal) if the csproj write failed, times out (90s), or is disabled — C# settings are still written; re-run Setup if needed
- Slim IntelliSense does not compile against every Engine module’s Build.cs (by design). You get UBT APIs (`ModuleRules`, `TargetRules`, etc.); cross-references into Engine `*.Build.cs` files won’t resolve
- Extension install uses `workbench.extensions.installExtension`; if that fails, Setup opens marketplace search and continues
- Works best on Windows

## Release Notes

### 1.1.0 (July 2026)
- Cursor IDE support with dual-host IntelliSense profiles (Cursor vs VS Code)
- On Cursor: clangd IntelliSense; Microsoft/Anysphere C++ IntelliSense disabled to avoid conflicts
- Real C++ error squiggles again (no blanket diagnostic suppress on project Source)
- C# Build.cs / Target.cs IntelliSense via a slim BuildRules solution (avoids scanning the entire Engine)
- Setup ensures required IDE extensions first (host-aware), then patches configs, then prompts Reload
- Soft Install / Dismiss for missing extensions; Python and extras optional
- Git init command retained
- Fixes: restore hang from filled stdout buffer; VS Code Python checklist no longer treating Cursor Pyright as installed; clearer Setup progress and reload UX

### 1.0.1 (June 2026)
- Fixed TypeScript errors and updated type definitions for test suite
- Updated dependencies to address package vulnerabilities
- Quality of life improvements

### 1.0.0 (March 2026)
- Full IntelliSense + excludes patching
- Added strong Git init guards with confirmation dialogs
- Clean native TypeScript implementation


---

Made with ❤️ for the Unreal community.  
Feedback / issues welcome on GitHub!
