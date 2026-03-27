param(
  [string]$ReleaseDir = "",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $scriptDir
$installerScriptPath = Join-Path $appRoot "installer\SBERelay.iss"

if ([string]::IsNullOrWhiteSpace($ReleaseDir)) {
  $ReleaseDir = Join-Path $appRoot "release\win"
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $appRoot "release\installer"
}

$releaseDirResolved = [System.IO.Path]::GetFullPath($ReleaseDir)
$outputDirResolved = [System.IO.Path]::GetFullPath($OutputDir)
$packageJsonPath = Join-Path $appRoot "package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$appVersion = [string]$packageJson.version

& (Join-Path $scriptDir "build-release-win.ps1") -ReleaseDir $releaseDirResolved

New-Item -ItemType Directory -Path $outputDirResolved -Force | Out-Null

$candidatePaths = @()
if ($env:INNO_SETUP_ISCC) {
  $candidatePaths += $env:INNO_SETUP_ISCC
}
if (${env:ProgramFiles(x86)}) {
  $candidatePaths += (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
}
if ($env:ProgramFiles) {
  $candidatePaths += (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
}

$isccPath = $candidatePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $isccPath) {
  throw "Inno Setup compiler not found. Install Inno Setup 6 or set INNO_SETUP_ISCC."
}

Write-Host "Building installer with Inno Setup..."
& $isccPath "/DSourceDir=$releaseDirResolved" "/DOutputDir=$outputDirResolved" "/DAppVersion=$appVersion" $installerScriptPath
