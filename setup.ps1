#Requires -Version 5.1
<#
.SYNOPSIS
    One-step setup for the SharePoint Page Migration Agent (Windows / PowerShell).

.DESCRIPTION
    Locates Node.js (even if it isn't on PATH yet) and adds it to your PATH,
    installs npm dependencies, builds the MCP server, runs a smoke test, verifies
    both MCP servers start, and ensures a .mcp.json config exists in the repo root.

    Run it from anywhere:  powershell -ExecutionPolicy Bypass -File .\setup.ps1

.PARAMETER SkipTest
    Skip the post-build smoke test.

.PARAMETER Force
    Overwrite an existing .mcp.json with the default config.

.PARAMETER NoPathFix
    Do not modify your PATH even if Node.js is installed but not on PATH.
#>
[CmdletBinding()]
param(
    [switch]$SkipTest,
    [switch]$Force,
    [switch]$NoPathFix
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [ok] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "    $msg" -ForegroundColor Gray }
function Write-Warn2($msg){ Write-Host "    [!] $msg" -ForegroundColor Yellow }
function Write-Err2($msg) { Write-Host "    [x] $msg" -ForegroundColor Red }

# Find node.exe even when it is not on PATH, by scanning common install
# locations (official installer, nvm-for-windows, fnm, volta). Returns the full
# path to node.exe, or $null if nothing is found.
function Find-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $fixedCandidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
        (Join-Path $env:USERPROFILE '.volta\bin\node.exe')
    )
    foreach ($c in $fixedCandidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }

    # Version-manager layouts: pick the newest node.exe found under each root.
    $searchRoots = @(
        (Join-Path $env:APPDATA 'nvm'),
        (Join-Path $env:LOCALAPPDATA 'fnm\node-versions'),
        (Join-Path $env:LOCALAPPDATA 'fnm_multishells')
    )
    foreach ($root in $searchRoots) {
        if ($root -and (Test-Path $root)) {
            $found = Get-ChildItem -Path $root -Recurse -Filter 'node.exe' -ErrorAction SilentlyContinue |
                     Sort-Object FullName -Descending | Select-Object -First 1
            if ($found) { return $found.FullName }
        }
    }
    return $null
}

# Prepend a directory to the persistent *user* PATH (survives restarts).
# Returns $true if it made a change, $false if the dir was already present.
function Add-DirToUserPath([string]$dir) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    $parts = $userPath -split ';' | Where-Object { $_ -ne '' }
    if ($parts -contains $dir) { return $false }
    $newPath = (@($dir) + $parts) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    return $true
}

# Resolve the repository root as the directory this script lives in.
$RepoRoot = $PSScriptRoot
$McpDir   = Join-Path $RepoRoot 'mcp-server'

Write-Host "SharePoint Page Migration Agent - setup" -ForegroundColor White
Write-Info "Repo root: $RepoRoot"

if (-not (Test-Path $McpDir)) {
    Write-Err2 "Could not find the 'mcp-server' folder next to this script."
    Write-Info "Run this script from inside the cloned repository."
    exit 1
}

# ---------------------------------------------------------------------------
# 1. Node.js / npm
# ---------------------------------------------------------------------------
Write-Step "Checking Node.js and npm"

$wasOnPath = [bool](Get-Command node -ErrorAction SilentlyContinue)
$nodeExe = Find-NodeExe
if (-not $nodeExe) {
    Write-Err2 "Could not find Node.js anywhere on this machine."
    Write-Info "Install the LTS build from https://nodejs.org (keep 'Add to PATH' checked),"
    Write-Info "then CLOSE this window, open a new one, and run this script again."
    exit 1
}

$nodeDir = Split-Path -Parent $nodeExe

# Make node/npm/npx usable for the rest of THIS script run.
if ((($env:PATH -split ';') -notcontains $nodeDir)) {
    $env:PATH = "$nodeDir;$env:PATH"
}

# If Node wasn't on PATH, fix it so your AI host can spawn node/npx later.
if (-not $wasOnPath) {
    Write-Warn2 "Node.js is installed at $nodeDir but was not on your PATH."
    if ($NoPathFix) {
        Write-Warn2 "Skipping PATH fix (-NoPathFix). The MCP host may fail to start node/npx"
        Write-Warn2 "until you add $nodeDir to your PATH manually."
    }
    elseif (Add-DirToUserPath $nodeDir) {
        Write-Ok "Added $nodeDir to your user PATH."
        Write-Warn2 "IMPORTANT: restart your terminal AND your AI host so they pick up the new PATH."
    }
    else {
        Write-Ok "$nodeDir is already in your user PATH (restart your terminal/host to load it)."
    }
}

$nodeVersion = (& $nodeExe -v).Trim()          # e.g. v20.11.1
$major = 0
[void][int]::TryParse((($nodeVersion.TrimStart('v')).Split('.')[0]), [ref]$major)
Write-Ok "node $nodeVersion  ($nodeExe)"

if ($major -lt 20) {
    Write-Err2 "Node.js 20 or newer is required (found $nodeVersion)."
    Write-Info "Both the migration server and the playwright MCP server need Node.js 20+."
    Write-Info "Install the LTS build from https://nodejs.org, open a new window, and re-run."
    exit 1
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Err2 "npm is not on your PATH (it normally installs alongside Node.js)."
    Write-Info "Reinstall Node.js from https://nodejs.org and try again."
    exit 1
}
Write-Ok "npm $((& npm -v).Trim())"

# ---------------------------------------------------------------------------
# 2-4. Install, build, test (inside mcp-server)
# ---------------------------------------------------------------------------
Push-Location $McpDir
try {
    Write-Step "Installing dependencies (npm install)"
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
    Write-Ok "Dependencies installed"

    Write-Step "Building the MCP server (npm run build)"
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)." }
    Write-Ok "Build complete (dist/ generated)"

    if (-not $SkipTest) {
        Write-Step "Running smoke test (test/test-safelinks.cjs)"
        & node test/test-safelinks.cjs
        if ($LASTEXITCODE -ne 0) { throw "Smoke test failed (exit $LASTEXITCODE)." }
        Write-Ok "Smoke test passed"
    }

    Write-Step "Verifying the MCP server starts (initialize handshake)"
    & node test/check-server-start.cjs
    if ($LASTEXITCODE -ne 0) { throw "MCP server did not start correctly (exit $LASTEXITCODE)." }
    Write-Ok "MCP server starts and responds"

    Write-Step "Verifying the optional playwright MCP server (best-effort)"
    & node test/check-playwright-start.cjs
    if ($LASTEXITCODE -ne 0) {
        Write-Warn2 "Optional playwright MCP server did not start (needs network access to download it)."
        Write-Warn2 "Core migration still works without it. You can remove 'playwright' from .mcp.json if unused."
    } else {
        Write-Ok "playwright MCP server starts and responds"
    }
}
catch {
    Write-Err2 $_.Exception.Message
    exit 1
}
finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 5. .mcp.json
# ---------------------------------------------------------------------------
Write-Step "Ensuring .mcp.json exists in the repo root"

$mcpJsonPath = Join-Path $RepoRoot '.mcp.json'
$defaultConfig = @'
{
  "mcpServers": {
    "classic-to-modern": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/start.cjs"]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
'@

if ((Test-Path $mcpJsonPath) -and -not $Force) {
    Write-Ok ".mcp.json already present (use -Force to overwrite with defaults)"
}
else {
    Set-Content -Path $mcpJsonPath -Value $defaultConfig -Encoding UTF8
    Write-Ok ".mcp.json written"
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor White
Write-Info "1. Start your AI host from this folder:  copilot   (or)   claude"
Write-Info "2. Run /mcp and confirm 'classic-to-modern' is loaded."
Write-Info "3. Ask it to migrate a classic SharePoint page URL."
