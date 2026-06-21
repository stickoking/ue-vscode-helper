# Unreal Engine VS Code Helper

**One-click IntelliSense fix + massive performance boost + smart Git init for Unreal Engine 5 projects.**

Tired of red squiggles, slow VS Code, and messy project files after generating Visual Studio Code files in the Unreal Editor?  
This extension fixes it all in one click.

## Features

- **IntelliSense Fix** — Automatically patches `c_cpp_properties.json` with correct compileCommands, forced includes, and proper paths  
- **Performance Boost** — Adds smart excludes for `files.watcherExclude`, `files.exclude`, `C_Cpp.files.exclude`, and `search.exclude` (stops VS Code from scanning the entire Engine folder)  
- **Git Init (optional)** — One-click Git repository setup with a battle-tested Unreal `.gitignore`, initial commit, and optional GitHub remote  
- Works with UE 5.4+ (easily configurable for any version)

## How to Use

1. Open your Unreal Engine project folder in VS Code  
2. Press `Ctrl+Shift+P` and run one of these commands:

   - **Unreal: Setup VS Code (IntelliSense + Excludes)** ← Run this after "Generate Visual Studio Code Project Files" in the Unreal Editor  
   - **Unreal: Init Git + .gitignore** ← Sets up Git safely (skips if already initialized)

3. Press `Ctrl+R` (Reload Window) once to apply changes

## Extension Settings

- `ue-vscode-helper.enginePath`  
  Default: `C:\Program Files\Epic Games\UE_5.4`  
  Change this if you use a different UE version (e.g. UE_5.5, UE_5.6, etc.)

## Requirements

- Unreal Engine 5.4 or newer  
- "Generate Visual Studio Code Project Files" already run in the Unreal Editor  
- Git installed (only needed for the Git init command)

## Known Issues

- The Definitions.*.h file must exist (run your project once in the Editor after generating project files)  
- Works best on Windows

## Release Notes

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
