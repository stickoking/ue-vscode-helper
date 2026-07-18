# Install & smoke-test (1.1.0)

## Install

From this repo root (after `npm run vsix` or with the built VSIX):

```powershell
# Cursor (required for this project)
cursor --install-extension .\ue-vscode-helper-1.1.0.vsix

# Optional: also install into VS Code
code --install-extension .\ue-vscode-helper-1.1.0.vsix
```

Or run:

```powershell
.\scripts\install-and-test.ps1
# add -AlsoVSCode to install into Code as well
```

Reload the window after install.

## Smoke checklist

Open an Unreal project (folder that contains `*.uproject`), then:

1. **Setup** — Command Palette → `Unreal: Setup IntelliSense + Excludes`
   - Extensions prompt runs **before** config patch (Install / Dismiss)
   - Ends with a **Reload Window** prompt
2. **Cursor C++** — hover / Ctrl+click on a game `.h` / `.cpp` works (clangd)
   - Settings: `C_Cpp.intelliSenseEngine` is **disabled**
   - No `ms-vscode.cpptools` in workspace recommendations
3. **Build.cs IntelliSense (Cursor)** — open a `*.Build.cs`
   - Not stuck as “Miscellaneous Files”
   - `dotnet.defaultSolution` points at `.vscode/<Project>.BuildRules.IntelliSense.sln`
4. **compile_commands** — root `compile_commands.json` refreshed from `.vscode/compileCommands_*.json`
5. **VS Code host (if testing Code)** — after Setup in Code:
   - `C_Cpp.intelliSenseEngine` is **default** (re-enabled)
   - `ms-vscode.cpptools` is **not** in `unwantedRecommendations`
   - Cursor-only `dotnet.dotnetPath` / terminal `DOTNET_*` cleared
