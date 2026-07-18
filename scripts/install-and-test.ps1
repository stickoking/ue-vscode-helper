# Install ue-vscode-helper VSIX into Cursor (and optionally VS Code).
# Usage:
#   .\scripts\install-and-test.ps1
#   .\scripts\install-and-test.ps1 -AlsoVSCode
#   .\scripts\install-and-test.ps1 -VsixPath .\ue-vscode-helper-1.1.0.vsix

param(
    [string]$VsixPath = "",
    [switch]$AlsoVSCode
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not $VsixPath) {
    $latest = Get-ChildItem -Path $repoRoot -Filter "ue-vscode-helper-*.vsix" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $latest) {
        Write-Host "No VSIX found. Building..."
        npm run compile
        npm run vsix
        $latest = Get-ChildItem -Path $repoRoot -Filter "ue-vscode-helper-*.vsix" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    }
    if (-not $latest) { throw "Failed to find or build a VSIX." }
    $VsixPath = $latest.FullName
}

$VsixPath = (Resolve-Path $VsixPath).Path
$sizeKb = [math]::Round((Get-Item $VsixPath).Length / 1KB, 1)
Write-Host "VSIX: $VsixPath ($sizeKb KB)"

$cursor = Get-Command cursor -ErrorAction SilentlyContinue
if (-not $cursor) { throw "'cursor' CLI not found on PATH." }
Write-Host "Installing into Cursor..."
& cursor --install-extension $VsixPath
if ($LASTEXITCODE -ne 0) { throw "cursor --install-extension failed ($LASTEXITCODE)" }

if ($AlsoVSCode) {
    $code = Get-Command code -ErrorAction SilentlyContinue
    if (-not $code) {
        Write-Warning "'code' CLI not found — skipped VS Code install."
    } else {
        Write-Host "Installing into VS Code..."
        & code --install-extension $VsixPath
        if ($LASTEXITCODE -ne 0) { throw "code --install-extension failed ($LASTEXITCODE)" }
    }
}

Write-Host ""
Write-Host "Done. Reload the window, then run smoke tests from INSTALL-TEST.md:"
Write-Host "  1. Unreal: Setup IntelliSense + Excludes"
Write-Host "  2. C++ hover (Cursor: clangd; C_Cpp disabled)"
Write-Host "  3. Build.cs IntelliSense via slim .sln"
Write-Host "  4. Reload prompt after Setup"
Write-Host "  5. Extensions ensure runs before config patch"
