param(
  [string]$ReleaseDir = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent (Split-Path -Parent $appRoot)

if ([string]::IsNullOrWhiteSpace($ReleaseDir)) {
  $ReleaseDir = Join-Path $appRoot "release\win"
}

$releaseDirResolved = [System.IO.Path]::GetFullPath($ReleaseDir)
$distDir = Join-Path $appRoot "dist"
$templatesDir = Join-Path $appRoot "player-count\templates"
$dotenvDir = Join-Path $repoRoot "node_modules\dotenv"
$wsDir = Join-Path $repoRoot "node_modules\ws"
$iconSource = Join-Path $repoRoot "apps\web\public\favicon.ico"
$launcherCmdPath = Join-Path $releaseDirResolved "SBE Relay Launcher.cmd"
$trayScriptPath = Join-Path $releaseDirResolved "SBE Relay Tray.ps1"
$trayVbsPath = Join-Path $releaseDirResolved "SBE Relay Tray.vbs"
$iconTargetPath = Join-Path $releaseDirResolved "SBE Relay.ico"
$readmePath = Join-Path $releaseDirResolved "README.txt"
$buildInfoPath = Join-Path $releaseDirResolved "build-info.json"
$envExampleSource = Join-Path $appRoot ".env.example"
$envExampleTarget = Join-Path $releaseDirResolved ".env.example"
$embeddedEnvSource = $env:SBE_RELAY_EMBED_ENV_PATH
$defaultProdEnvSource = Join-Path $appRoot ".env.production"
$rootProdEnvSource = Join-Path $repoRoot ".env.prod"
$embeddedEnvTarget = Join-Path $releaseDirResolved ".env"
$packageJsonPath = Join-Path $appRoot "package.json"
$allowedEnvKeys = @(
  "RELAY_BACKEND_URL",
  "RELAY_SHARED_TOKEN",
  "RELAY_HTTP_PORT",
  "RELAY_ROOM_ID",
  "RELAY_PLAYER_ID",
  "RELAY_LOG_RAW_GSI",
  "RELAY_ROUND_LIVE_DURATION_SEC",
  "RELAY_BOMB_TIMER_SEC",
  "RELAY_GSI_CONFIG_ENABLED",
  "RELAY_GSI_URI",
  "RELAY_GSI_CONFIG_PATH",
  "RELAY_LAUNCHER_POLL_MS",
  "DEBUG",
  "SBE_DATA_DIR",
  "PLAYER_COUNT_ENABLED",
  "PLAYER_COUNT_FORMULA_MODE",
  "PLAYER_COUNT_AUTO_CALIBRATE",
  "PLAYER_COUNT_BASE_SCREEN_WIDTH",
  "PLAYER_COUNT_BASE_SCREEN_HEIGHT",
  "PLAYER_COUNT_BASE_GAME_WIDTH",
  "PLAYER_COUNT_BASE_GAME_HEIGHT",
  "PLAYER_COUNT_SCREEN_WIDTH",
  "PLAYER_COUNT_SCREEN_HEIGHT",
  "PLAYER_COUNT_GAME_WIDTH",
  "PLAYER_COUNT_GAME_HEIGHT",
  "PLAYER_COUNT_DEBUG_PERSIST_ARTIFACTS",
  "PLAYER_COUNT_MIN_CONFIDENCE",
  "PLAYER_COUNT_ROI1_UR_X",
  "PLAYER_COUNT_ROI1_UR_Y",
  "PLAYER_COUNT_ROI1_LL_X",
  "PLAYER_COUNT_ROI1_LL_Y",
  "PLAYER_COUNT_ROI2_UR_X",
  "PLAYER_COUNT_ROI2_UR_Y",
  "PLAYER_COUNT_ROI2_LL_X",
  "PLAYER_COUNT_ROI2_LL_Y"
)

if (-not (Test-Path $packageJsonPath)) {
  throw "Relay package.json not found: $packageJsonPath"
}

$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$appVersion = [string]$packageJson.version

function Get-EnvValueFromFile {
  param(
    [string]$FilePath,
    [string]$Key
  )

  if (-not (Test-Path $FilePath)) {
    return $null
  }

  foreach ($line in Get-Content $FilePath) {
    if ($line -match "^\s*$Key=(.*)$") {
      return $matches[1].Trim()
    }
  }

  return $null
}

function Read-EnvFile {
  param(
    [string]$FilePath
  )

  $values = [ordered]@{}
  if (-not (Test-Path $FilePath)) {
    return $values
  }

  foreach ($line in Get-Content $FilePath) {
    if ($line -match '^\s*$') {
      continue
    }
    if ($line -match '^\s*#') {
      continue
    }
    if ($line -match '^\s*([^=]+?)=(.*)$') {
      $key = $matches[1].Trim()
      $value = $matches[2]
      $values[$key] = $value
    }
  }

  return $values
}

function Write-FilteredEnvFile {
  param(
    [hashtable]$SourceValues,
    [string]$TargetPath,
    [string[]]$AllowedKeys
  )

  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($key in $AllowedKeys) {
    if (-not $SourceValues.Contains($key)) {
      continue
    }
    $lines.Add("${key}=$($SourceValues[$key])")
  }

  [System.IO.File]::WriteAllLines($TargetPath, $lines)
}

Write-Host "Building @sbe/relay..."
Push-Location $repoRoot
try {
  & npm run build -w @sbe/relay
} finally {
  Pop-Location
}

if (-not (Test-Path $distDir)) {
  throw "Relay dist folder not found: $distDir"
}
if (-not (Test-Path $templatesDir)) {
  throw "Player-count templates not found: $templatesDir"
}
if (-not (Test-Path $dotenvDir)) {
  throw "dotenv runtime dependency not found: $dotenvDir"
}
if (-not (Test-Path $wsDir)) {
  throw "ws runtime dependency not found: $wsDir"
}
if (-not (Test-Path $iconSource)) {
  throw "Relay icon source not found: $iconSource"
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeExePath = $nodeCommand.Source

if (Test-Path $releaseDirResolved) {
  Remove-Item $releaseDirResolved -Recurse -Force
}

New-Item -ItemType Directory -Path $releaseDirResolved | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseDirResolved "node_modules") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseDirResolved "player-count") | Out-Null

Copy-Item $nodeExePath (Join-Path $releaseDirResolved "node.exe")
Copy-Item $iconSource $iconTargetPath
Copy-Item $distDir (Join-Path $releaseDirResolved "dist") -Recurse
Copy-Item $templatesDir (Join-Path $releaseDirResolved "player-count\templates") -Recurse
Copy-Item $dotenvDir (Join-Path $releaseDirResolved "node_modules\dotenv") -Recurse
Copy-Item $wsDir (Join-Path $releaseDirResolved "node_modules\ws") -Recurse

Get-ChildItem -Path (Join-Path $releaseDirResolved "dist") -Recurse -Filter "*.test.js" | Remove-Item -Force

if (Test-Path $envExampleSource) {
  Copy-Item $envExampleSource $envExampleTarget
}

if ($embeddedEnvSource -and (Test-Path $embeddedEnvSource)) {
  $embeddedEnvValues = Read-EnvFile -FilePath $embeddedEnvSource
  Write-FilteredEnvFile -SourceValues $embeddedEnvValues -TargetPath $embeddedEnvTarget -AllowedKeys $allowedEnvKeys
} elseif (Test-Path $defaultProdEnvSource) {
  $embeddedEnvValues = Read-EnvFile -FilePath $defaultProdEnvSource
  Write-FilteredEnvFile -SourceValues $embeddedEnvValues -TargetPath $embeddedEnvTarget -AllowedKeys $allowedEnvKeys
}

if (Test-Path $embeddedEnvTarget) {
  $embeddedEnvContent = Get-Content $embeddedEnvTarget -Raw
  $backendUrlOverride = $env:SBE_RELAY_BACKEND_URL
  $sharedTokenOverride = $env:RELAY_SHARED_TOKEN

  if (-not $sharedTokenOverride) {
    $sharedTokenOverride = Get-EnvValueFromFile -FilePath $rootProdEnvSource -Key "RELAY_SHARED_TOKEN"
  }

  if ($backendUrlOverride) {
    $embeddedEnvContent = [System.Text.RegularExpressions.Regex]::Replace(
      $embeddedEnvContent,
      "(?m)^RELAY_BACKEND_URL=.*$",
      "RELAY_BACKEND_URL=$backendUrlOverride"
    )
  }

  if ($sharedTokenOverride) {
    $embeddedEnvContent = [System.Text.RegularExpressions.Regex]::Replace(
      $embeddedEnvContent,
      "(?m)^RELAY_SHARED_TOKEN=.*$",
      "RELAY_SHARED_TOKEN=$sharedTokenOverride"
    )
  }

  Set-Content -Path $embeddedEnvTarget -Value $embeddedEnvContent -Encoding ASCII
}

$launcherCmdContent = @'
@echo off
setlocal
set "APP_DIR=%~dp0"
set "SBE_APP_DIR=%APP_DIR%"
set "SBE_ENV_PATH=%APP_DIR%.env"
"%APP_DIR%node.exe" "%APP_DIR%dist\apps\relay\src\launcher.js"
'@
Set-Content -Path $launcherCmdPath -Value $launcherCmdContent -Encoding ASCII

$trayScriptContent = @'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:SBE_APP_DIR = $appDir
$env:SBE_ENV_PATH = Join-Path $appDir ".env"
$launcherScript = Join-Path $appDir "dist\apps\relay\src\launcher.js"
$iconPath = Join-Path $appDir "SBE Relay.ico"
$trayMutex = $null

function Get-EnvValue {
  param(
    [string]$Key,
    [string]$Fallback
  )

  $processValue = [System.Environment]::GetEnvironmentVariable($Key, "Process")
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return $processValue.Trim()
  }

  $machineValue = [System.Environment]::GetEnvironmentVariable($Key, "User")
  if (-not [string]::IsNullOrWhiteSpace($machineValue)) {
    return $machineValue.Trim()
  }

  if (Test-Path $env:SBE_ENV_PATH) {
    foreach ($line in Get-Content $env:SBE_ENV_PATH) {
      if ($line -match '^\s*#') { continue }
      if ($line -match "^\s*$Key=(.*)$") {
        $value = $matches[1].Trim()
        if (-not [string]::IsNullOrWhiteSpace($value)) {
          return $value
        }
      }
    }
  }

  return $Fallback
}

function Get-RelayDataDir {
  $explicitDataDir = Get-EnvValue -Key "SBE_DATA_DIR" -Fallback ""
  if (-not [string]::IsNullOrWhiteSpace($explicitDataDir)) {
    return [System.IO.Path]::GetFullPath($explicitDataDir)
  }

  $localAppData = [System.Environment]::GetFolderPath("LocalApplicationData")
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    $localAppData = Join-Path $HOME "AppData\Local"
  }

  return Join-Path $localAppData "SBE Relay"
}

function Get-LauncherLogPath {
  return Join-Path (Join-Path (Get-RelayDataDir) "logs") "launcher.log"
}

function Ensure-LogPath {
  $logPath = Get-LauncherLogPath
  $logDir = Split-Path -Parent $logPath
  [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
  if (-not (Test-Path $logPath)) {
    [System.IO.File]::WriteAllText($logPath, "")
  }
  return $logPath
}

function Write-TrayLogLine {
  param(
    [string]$Event,
    [hashtable]$Data = @{}
  )

  $payload = [ordered]@{
    event = $Event
    ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  }

  foreach ($key in $Data.Keys) {
    $payload[$key] = $Data[$key]
  }

  $line = ($payload | ConvertTo-Json -Compress)
  [System.IO.File]::AppendAllText((Ensure-LogPath), "$line`r`n")
}

trap {
  try {
    Write-TrayLogLine -Event "relay_tray_unhandled_error" -Data @{
      message = $_.Exception.Message
      details = ($_ | Out-String).Trim()
    }
  } catch {}
  continue
}

function Acquire-TrayMutex {
  $createdNew = $false
  $mutex = New-Object System.Threading.Mutex($true, "Local\SBERelayTraySingleton", [ref]$createdNew)
  if (-not $createdNew) {
    Write-TrayLogLine -Event "relay_tray_already_running"
    $mutex.Dispose()
    return $null
  }

  Write-TrayLogLine -Event "relay_tray_started"
  return $mutex
}

function Stop-LauncherProcessTree {
  param([System.Diagnostics.Process]$Process)
  if (-not $Process) { return }
  try {
    if ($Process.HasExited) { return }
  } catch {
    return
  }

  Start-Process -FilePath "taskkill.exe" -ArgumentList @("/PID", "$($Process.Id)", "/T", "/F") -WindowStyle Hidden -Wait
}

function Start-LauncherProcess {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = Join-Path $appDir "node.exe"
  $startInfo.Arguments = "`"$launcherScript`""
  $startInfo.WorkingDirectory = $appDir
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $process.EnableRaisingEvents = $true
  $process.Start() | Out-Null
  Write-TrayLogLine -Event "relay_tray_launcher_process_started" -Data @{ pid = $process.Id }
  return $process
}

function Format-LogTimestamp {
  param([object]$Value)

  if ($null -eq $Value) {
    return $null
  }

  try {
    $timestamp = [int64]$Value
    if ($timestamp -gt 0) {
      return [System.DateTimeOffset]::FromUnixTimeMilliseconds($timestamp).ToLocalTime().ToString("HH:mm:ss.fff")
    }
  } catch {
    return $null
  }

  return $null
}

function Format-LogEntry {
  param([string]$Line)

  $trimmed = $Line.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return ""
  }

  try {
    $entry = $trimmed | ConvertFrom-Json -ErrorAction Stop
    $headerParts = New-Object System.Collections.Generic.List[string]
    $timestamp = Format-LogTimestamp -Value $entry.ts
    if ($timestamp) {
      $headerParts.Add($timestamp)
    }
    if ($entry.type) {
      $headerParts.Add("[$($entry.type)]")
    }
    if ($entry.event) {
      $headerParts.Add([string]$entry.event)
    }

    $header = [string]::Join(" ", $headerParts)
    $prettyJson = $entry | ConvertTo-Json -Depth 8
    if ([string]::IsNullOrWhiteSpace($header)) {
      return $prettyJson
    }

    return "$header`r`n$prettyJson"
  } catch {
    return $trimmed
  }
}

function Read-FormattedLogTail {
  param(
    [string]$Path,
    [int]$MaxEntries = 80
  )

  if (-not (Test-Path $Path)) {
    return "No logs yet."
  }

  $lines = [System.IO.File]::ReadAllLines($Path) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($lines.Count -eq 0) {
    return "No logs yet."
  }

  if ($lines.Count -gt $MaxEntries) {
    $lines = $lines[($lines.Count - $MaxEntries)..($lines.Count - 1)]
  }

  $formattedEntries = foreach ($line in $lines) {
    Format-LogEntry -Line $line
  }

  return ($formattedEntries | Where-Object { $_ -ne "" }) -join ("`r`n`r`n")
}

$null = Ensure-LogPath
$trayMutex = Acquire-TrayMutex
if ($null -eq $trayMutex) {
  exit 0
}
$launcherProcess = Start-LauncherProcess
$lastLauncherExitLoggedPid = $null

function Log-LauncherExitIfNeeded {
  if (-not $script:launcherProcess) {
    return
  }

  try {
    if (-not $script:launcherProcess.HasExited) {
      return
    }
  } catch {
    return
  }

  if ($lastLauncherExitLoggedPid -eq $script:launcherProcess.Id) {
    return
  }

  $payload = @{ pid = $script:launcherProcess.Id }
  try {
    $payload.exitCode = $script:launcherProcess.ExitCode
  } catch {}

  Write-TrayLogLine -Event "relay_tray_launcher_process_exited" -Data $payload
  $script:lastLauncherExitLoggedPid = $script:launcherProcess.Id
}

$logsForm = New-Object System.Windows.Forms.Form
$logsForm.Text = "SBE Relay Logs"
$logsForm.Size = New-Object System.Drawing.Size(900, 640)
$logsForm.StartPosition = "CenterScreen"

$logsBox = New-Object System.Windows.Forms.TextBox
$logsBox.Multiline = $true
$logsBox.ReadOnly = $true
$logsBox.ScrollBars = "Vertical"
$logsBox.WordWrap = $false
$logsBox.Dock = "Fill"
$logsBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$logsForm.Controls.Add($logsBox)

$refreshLogs = {
  $logPath = Ensure-LogPath
  $logsBox.Text = Read-FormattedLogTail -Path $logPath
  $logsBox.SelectionStart = $logsBox.TextLength
  $logsBox.ScrollToCaret()
}

$logsTimer = New-Object System.Windows.Forms.Timer
$logsTimer.Interval = 1000
$logsTimer.Add_Tick($refreshLogs)
$logsTimer.Start()
$logsForm.Add_Shown($refreshLogs)

$heartbeatTimer = New-Object System.Windows.Forms.Timer
$heartbeatTimer.Interval = 15000
$heartbeatTimer.Add_Tick({
  Log-LauncherExitIfNeeded
  Write-TrayLogLine -Event "relay_tray_heartbeat" -Data @{
    launcherPid = if ($launcherProcess -and -not $launcherProcess.HasExited) { $launcherProcess.Id } else { $null }
    logsVisible = $logsForm.Visible
  }
})
$heartbeatTimer.Start()

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = if (Test-Path $iconPath) { New-Object System.Drawing.Icon($iconPath) } else { [System.Drawing.SystemIcons]::Application }
$notifyIcon.Text = "SBE Relay"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$showLogsItem = $contextMenu.Items.Add("Show Logs")
$restartItem = $contextMenu.Items.Add("Restart Relay")
$openLogFileItem = $contextMenu.Items.Add("Open Log File")
$exitItem = $contextMenu.Items.Add("Exit")
$notifyIcon.ContextMenuStrip = $contextMenu

$showLogsAction = {
  & $refreshLogs
  if (-not $logsForm.Visible) {
    $logsForm.Show()
  }
  $logsForm.WindowState = "Normal"
  $logsForm.BringToFront()
  $logsForm.Activate()
}

$showLogsItem.Add_Click($showLogsAction)
$notifyIcon.Add_DoubleClick($showLogsAction)

$restartItem.Add_Click({
  Write-TrayLogLine -Event "relay_tray_restart_requested"
  Stop-LauncherProcessTree -Process $launcherProcess
  $script:launcherProcess = Start-LauncherProcess
  $script:lastLauncherExitLoggedPid = $null
  & $refreshLogs
})

$openLogFileItem.Add_Click({
  $logPath = Ensure-LogPath
  Start-Process -FilePath "notepad.exe" -ArgumentList "`"$logPath`""
})

$logsForm.Add_FormClosing({
  param($sender, $e)
  $e.Cancel = $true
  $logsForm.Hide()
})

$appContext = New-Object System.Windows.Forms.ApplicationContext

$shutdown = {
  Write-TrayLogLine -Event "relay_tray_exit_requested"
  $logsTimer.Stop()
  $heartbeatTimer.Stop()
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  Stop-LauncherProcessTree -Process $launcherProcess
  if ($trayMutex) {
    $trayMutex.ReleaseMutex()
    $trayMutex.Dispose()
  }
  $appContext.ExitThread()
}

$exitItem.Add_Click($shutdown)

try {
  [System.Windows.Forms.Application]::Run($appContext)
} finally {
  Write-TrayLogLine -Event "relay_tray_host_stopped"
}
'@
Set-Content -Path $trayScriptPath -Value $trayScriptContent -Encoding ASCII

$trayVbsContent = @'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\SBE Relay Tray.ps1"""
shell.Run command, 0, False
'@
Set-Content -Path $trayVbsPath -Value $trayVbsContent -Encoding ASCII

$readmeContent = @'
SBE Relay Windows Release

Start:
- Double-click "SBE Relay Tray.vbs"

Notes:
- The launcher watches for cs2.exe / csgo.exe and starts relay automatically.
- The tray icon stays in the Windows notification area.
- Double-click the tray icon to open live logs.
- Writable data is stored in %LOCALAPPDATA%\SBE Relay.
- Optional local overrides can be placed in .env next to this launcher.
'@
Set-Content -Path $readmePath -Value $readmeContent -Encoding ASCII

$buildInfo = @{
  app = "@sbe/relay"
  version = $appVersion
  built_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  node_exe = $nodeExePath
}
$buildInfo | ConvertTo-Json | Set-Content -Path $buildInfoPath -Encoding ASCII

Write-Host "Relay release folder prepared: $releaseDirResolved"
