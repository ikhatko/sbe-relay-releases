param(
  [string]$ReleaseDir = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $scriptDir
$devEnvPath = Join-Path $appRoot ".env.localhost.example"
$buildScriptPath = Join-Path $scriptDir "build-release-win.ps1"

if (-not (Test-Path $devEnvPath)) {
  throw "Localhost env file not found: $devEnvPath"
}

$env:SBE_RELAY_EMBED_ENV_PATH = $devEnvPath

try {
  & $buildScriptPath -ReleaseDir $ReleaseDir
} finally {
  Remove-Item Env:\SBE_RELAY_EMBED_ENV_PATH -ErrorAction SilentlyContinue
}
