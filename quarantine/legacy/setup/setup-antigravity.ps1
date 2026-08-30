# ==============================================================================
# All About Agents — Antigravity Setup Script (Windows PowerShell)
# ==============================================================================

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$GeminiDir = Join-Path $HOME ".gemini"
$ConfigDir = Join-Path $GeminiDir "config"
$PluginsDir = Join-Path $ConfigDir "plugins"
$TargetPluginDir = Join-Path $PluginsDir "all-about-agents"
$TargetSkillsDir = Join-Path $ConfigDir "skills"
$TargetAgentsDir = Join-Path $ConfigDir "agents"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  All About Agents — Antigravity Global Setup" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Repository Root : $RepoRoot"
Write-Host "Gemini Config   : $ConfigDir"
Write-Host ""

# 1. Check Node.js
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node -v
    Write-Host "  ✓ Node.js detected: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "  ! Warning: Node.js is not found on PATH. Lifecycle hooks require Node.js." -ForegroundColor Red
}

# 2. Ensure Directories
Write-Host "[2/7] Preparing directories..." -ForegroundColor Yellow
@($GeminiDir, $ConfigDir, $PluginsDir, $TargetPluginDir, $TargetSkillsDir, $TargetAgentsDir) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
        Write-Host "  ✓ Created directory: $_" -ForegroundColor Green
    }
}

# 3. Create Plugin Junctions & Manifest
Write-Host "[3/7] Configuring global plugin 'all-about-agents'..." -ForegroundColor Yellow

# Skills Junction
$PluginSkills = Join-Path $TargetPluginDir "skills"
$SourceSkills = Join-Path $RepoRoot "skills"
if (Test-Path $PluginSkills) {
    Remove-Item $PluginSkills -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Junction -Path $PluginSkills -Target $SourceSkills | Out-Null
Write-Host "  ✓ Linked skills junction: $PluginSkills -> $SourceSkills" -ForegroundColor Green

# Hooks Junction
$PluginHooks = Join-Path $TargetPluginDir "hooks"
$SourceHooks = Join-Path $RepoRoot "hooks"
if (Test-Path $PluginHooks) {
    Remove-Item $PluginHooks -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Junction -Path $PluginHooks -Target $SourceHooks | Out-Null
Write-Host "  ✓ Linked hooks junction: $PluginHooks -> $SourceHooks" -ForegroundColor Green

# Agents Junction
$PluginAgents = Join-Path $TargetPluginDir "agents"
$SourceAgents = Join-Path $RepoRoot "agents"
if (Test-Path $PluginAgents) {
    Remove-Item $PluginAgents -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $SourceAgents) {
    New-Item -ItemType Junction -Path $PluginAgents -Target $SourceAgents | Out-Null
    Write-Host "  ✓ Linked agents junction: $PluginAgents -> $SourceAgents" -ForegroundColor Green
}

# Manifest
$SourceManifest = Join-Path $RepoRoot ".claude-plugin\plugin.json"
$TargetManifest = Join-Path $TargetPluginDir "plugin.json"
if (Test-Path $SourceManifest) {
    Copy-Item -Path $SourceManifest -Destination $TargetManifest -Force
    Write-Host "  ✓ Copied plugin.json" -ForegroundColor Green
}

# Hooks Config
$SourceHooksConfig = Join-Path $RepoRoot "hooks\antigravity-hooks.json"
$TargetHooksConfig = Join-Path $TargetPluginDir "hooks.json"
if (Test-Path $SourceHooksConfig) {
    Copy-Item -Path $SourceHooksConfig -Destination $TargetHooksConfig -Force
    Copy-Item -Path $SourceHooksConfig -Destination (Join-Path $ConfigDir "hooks.json") -Force
    Write-Host "  ✓ Configured hooks.json" -ForegroundColor Green
}

# 4. Configure skills.json
Write-Host "[4/7] Updating ~/.gemini/config/skills.json..." -ForegroundColor Yellow
$skillsJsonPath = Join-Path $ConfigDir "skills.json"
$normalizedSkillsPath = ($SourceSkills -replace '\\', '/')

$skillsConfig = @{
    entries = @(
        @{
            path = $normalizedSkillsPath
        }
    )
}
$skillsConfig | ConvertTo-Json -Depth 5 | Set-Content -Path $skillsJsonPath -Encoding utf8
Write-Host "  ✓ Wrote skills.json pointing to $normalizedSkillsPath" -ForegroundColor Green

# 5. Link individual skills in ~/.gemini/config/skills/
Write-Host "[5/7] Linking individual skills into ~/.gemini/config/skills/..." -ForegroundColor Yellow
$skillCount = 0
Get-ChildItem -Path $SourceSkills -Directory | ForEach-Object {
    $linkPath = Join-Path $TargetSkillsDir $_.Name
    if (-not (Test-Path $linkPath)) {
        try {
            New-Item -ItemType Junction -Path $linkPath -Target $_.FullName -ErrorAction Stop | Out-Null
            $skillCount++
        } catch {
            Write-Host "  ! Failed to link $($_.Name): $_" -ForegroundColor Red
        }
    } else {
        $skillCount++
    }
}
Write-Host "  ✓ Verified $skillCount skills linked in $TargetSkillsDir" -ForegroundColor Green

# 6. Link individual agents in ~/.gemini/config/agents/ and ~/.claude/agents/
Write-Host "[6/7] Linking individual agents into ~/.gemini/config/agents/ & ~/.claude/agents/..." -ForegroundColor Yellow
$ClaudeAgentsDir = Join-Path (Join-Path $HOME ".claude") "agents"
if (-not (Test-Path $ClaudeAgentsDir)) {
    New-Item -ItemType Directory -Path $ClaudeAgentsDir -Force | Out-Null
}

$agentCount = 0
if (Test-Path $SourceAgents) {
    Get-ChildItem -Path $SourceAgents -Include "*.json","*.md" -Recurse | ForEach-Object {
        if ($_.Name -ne "README.md") {
            $targetGeminiAgentFile = Join-Path $TargetAgentsDir $_.Name
            $targetClaudeAgentFile = Join-Path $ClaudeAgentsDir $_.Name
            try {
                Copy-Item -Path $_.FullName -Destination $targetGeminiAgentFile -Force
                Copy-Item -Path $_.FullName -Destination $targetClaudeAgentFile -Force
                $agentCount++
            } catch {
                Write-Host "  ! Failed to copy agent $($_.Name): $_" -ForegroundColor Red
            }
        }
    }
}
Write-Host "  ✓ Verified $agentCount agent definitions registered in ~/.gemini and ~/.claude" -ForegroundColor Green

# 7. Link GEMINI.md Rules
Write-Host "[7/7] Linking global rules (~/.gemini/GEMINI.md)..." -ForegroundColor Yellow
$SourceRules = Join-Path $RepoRoot "configs\GEMINI.local.md"
$TargetRules = Join-Path $GeminiDir "GEMINI.md"

if (Test-Path $SourceRules) {
    if (Test-Path $TargetRules) {
        Remove-Item $TargetRules -Force -ErrorAction SilentlyContinue
    }
    try {
        New-Item -ItemType HardLink -Path $TargetRules -Target $SourceRules -ErrorAction Stop | Out-Null
        Write-Host "  ✓ Created HardLink: $TargetRules -> $SourceRules" -ForegroundColor Green
    } catch {
        try {
            New-Item -ItemType SymbolicLink -Path $TargetRules -Target $SourceRules -ErrorAction Stop | Out-Null
            Write-Host "  ✓ Created SymbolicLink: $TargetRules -> $SourceRules" -ForegroundColor Green
        } catch {
            Copy-Item -Path $SourceRules -Destination $TargetRules -Force
            Write-Host "  ✓ Copied rules to $TargetRules" -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Setup Completed Successfully! 🎉" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "To start using All About Agents in Antigravity:"
Write-Host "  1. Start a new chat session in Antigravity CLI (agy) or Antigravity IDE."
Write-Host "  2. Test with: 'Let''s make a react todo list'"
Write-Host ""
