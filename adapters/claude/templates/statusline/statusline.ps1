[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$renderer = Join-Path $PSScriptRoot "statusline.mjs"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
  [Console]::Error.WriteLine("Claude statusline unavailable: Node.js was not found on PATH.")
  exit 127
}
if (-not (Test-Path -LiteralPath $renderer -PathType Leaf)) {
  [Console]::Error.WriteLine("Claude statusline unavailable: the renderer is missing.")
  exit 1
}

& $node.Source $renderer
exit $LASTEXITCODE
