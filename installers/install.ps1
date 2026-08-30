[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]] $Arguments
)

$scriptPath = Join-Path $PSScriptRoot "..\scripts\aaa.mjs"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
  exit 127
}

& $node.Source $scriptPath @Arguments
exit $LASTEXITCODE
