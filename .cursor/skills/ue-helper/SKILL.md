---
name: ue-helper
description: >-
  Knowledge base for the ue-vscode-helper VS Code/Cursor extension that sets up
  Unreal Engine IntelliSense. Use when editing this extension, Setup/IntelliSense
  behavior, clangd/.clangd, Build.cs C# (BuildRules IntelliSense csproj/sln),
  ModuleRules/UE5Rules hangs, defaultSolution, excludes, host detection, or
  packaging/releasing the VSIX.
---

# ue-vscode-helper knowledge base

Dual-host extension: one command (**Unreal: Setup IntelliSense + Excludes**) applies Cursor or VS Code Unreal IntelliSense + engine excludes.

## Host detection

- `src/host.ts`: `detectHost()` → `/cursor/i.test(vscode.env.appName)`; `resolveHost()` respects `ue-vscode-helper.preferHost` (`auto` | `cursor` | `vscode`).
- Cursor → `profiles/cursor.ts`. VS Code → `profiles/vscode.ts` (Microsoft C++; no project-wide clangd suppress).

## Cursor C++ (clangd)

| Setting | Value |
|---------|--------|
| `clangd.enable` | `true` |
| `C_Cpp.intelliSenseEngine` / autocomplete / errorSquiggles / formatting | `disabled` |
| `compile_commands.json` | Project **root** (copy from `.vscode/compileCommands_*.json` if missing) |
| `.clangd` | `CompilationDatabase: .` |

### `.clangd` — never regress

**Project fragment:** real diagnostics. Only mute `UnusedIncludes` / `MissingIncludes`. **Do NOT** put `Diagnostics.Suppress: ["*"]` on the project fragment (0.2.2 lesson — hides all squiggles).

**Engine PathMatch only:** `Suppress: ["*"]` + `Index.Background: Skip` (Epic Games / `UE_5.x` / `Engine/Source`).

Template: `buildClangdConfigContent()` in `profiles/cursor.ts`.

## Cursor C# (Build.cs / Target.cs)

### Correct setup (0.2.6+)

Setup **always**:

1. Write `.vscode/<Project>.BuildRules.IntelliSense.csproj` — game `*.Build.cs` / `*.Target.cs` + ProjectReference **UnrealBuildTool** + **EpicGames.Build** only. **No UE5Rules / UE5ProgramRules**.
2. Write `.vscode/<Project>.BuildRules.IntelliSense.sln` wrapping that csproj only.
3. Set `dotnet.defaultSolution` to the **`.sln` relative path** (e.g. `.vscode/Foo.BuildRules.IntelliSense.sln`).
4. Optional `dotnet restore` on the **slim csproj** (90s timeout, non-fatal; gated by `restoreModuleRules`).
5. Also set UE `dotnet.dotnetPath`, openFiles analysis scopes.

Helpers: `buildRulesIntelliSenseCsproj/Sln/SlnRelative` in `engine.ts`; writers + restore in `profiles/cursor.ts`.

### Forbidden (causes hang / “Miscellaneous Files”)

| Bad target | Why |
|------------|-----|
| `Intermediate/.../<Project>ModuleRules.csproj` | ProjectReferences **UE5Rules** (~2500 Engine Build.cs) — LS never finishes |
| Root `<Project>.sln` | Same ModuleRules → UE5Rules graph |
| `dotnet.defaultSolution` = **`.csproj` only** | `anysphere.csharp` ignores csproj-only defaultSolution and auto-loads root `*.sln` (0.2.5→0.2.6) |

**Never open the root Unreal `.sln` for C# IntelliSense.** Use the slim `.vscode/...IntelliSense.sln`. If status bar shows ModuleRules, run **.NET: Open Solution** and pick the slim sln, or re-run Setup.

Slim IntelliSense gives UBT APIs (`ModuleRules`, `TargetRules`, …); it does **not** resolve into Engine `*.Build.cs` files (by design).

## Setup orchestration (`extension.ts`)

Order matters:

1. Apply profile (clangd / compile_commands / slim csproj+sln writers).
2. Patch excludes + settings into `.code-workspace` **and** `.vscode/settings.json` (**before** restore).
3. Cursor: restore slim csproj (timeout).
4. **After** `withProgress` closes: clangd install hint; **Reload Window** / Later prompt.

Do not nest modals inside `withProgress` (0.2.1 — looks stuck on “Patching excludes…”).

## Excludes

`excludes.ts`: Engine / Intermediate / Saved / DerivedDataCache / etc. Mirror to workspace + `.vscode/settings.json`.

## After Unreal regen

Unreal **Generate VS Code project files** often resets `.code-workspace` / C++ settings. **Re-run Setup**. If hover/Ctrl+click dies, Unreal likely reset the workspace — re-enable clangd via Setup (and ensure C_Cpp IntelliSense stays disabled).

## Version lessons (0.2.1–0.2.6)

| Ver | Lesson |
|-----|--------|
| **0.2.1** | Progress steps; 90s restore timeout; write C# settings before restore; dialogs outside `withProgress` |
| **0.2.2** | No project-wide `Suppress: ["*"]` in `.clangd` |
| **0.2.3** | Lock Cursor checklist; VS Code must not get clangd suppress-all |
| **0.2.4** | Always show Reload Window prompt after success |
| **0.2.5** | Slim IntelliSense **csproj** (no UE5Rules) instead of Intermediate ModuleRules |
| **0.2.6** | Slim **`.sln` wrapper**; `defaultSolution` **must be `.sln`** (csproj alone ignored) |
| **0.2.7** | Repo rule + this skill; document pitfalls for cold agents |

## Packaging

```bash
npm run package
npm run vsix
cursor --install-extension ue-vscode-helper-<version>.vsix
```

Bump `package.json` version + CHANGELOG + README install line together.

## Anti-patterns checklist

- [ ] No `Suppress: ["*"]` on project `.clangd` fragment
- [ ] No `dotnet.defaultSolution` → ModuleRules / root `.sln` / bare `.csproj`
- [ ] Slim csproj references UBT + EpicGames.Build only
- [ ] Slim `.sln` exists and is what `defaultSolution` points at
- [ ] Restore timeout; settings written first; reload prompt outside progress
- [ ] Cursor ≠ VS Code profile (don’t force clangd suppress on VS Code)
