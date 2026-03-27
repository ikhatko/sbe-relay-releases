#define MyAppName "SBE Relay"
#ifndef AppVersion
  #define AppVersion "0.0.1"
#endif

#define MyAppVersion AppVersion
#define MyAppPublisher "SBE"
#define MyAppLauncherHost "{sys}\wscript.exe"
#define MyAppLauncherScript "SBE Relay Tray.vbs"
#define MyAppIconFile "SBE Relay.ico"

#ifndef SourceDir
  #define SourceDir "..\release\win"
#endif

#ifndef OutputDir
  #define OutputDir "..\release\installer"
#endif

[Setup]
AppId={{D1B5D780-6E08-4B49-B3A3-9AE6A3DA5C41}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf64}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir={#OutputDir}
OutputBaseFilename=SBERelaySetup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
SetupIconFile={#SourceDir}\{#MyAppIconFile}
UninstallDisplayIcon={app}\{#MyAppIconFile}

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{#MyAppLauncherHost}"; Parameters: """{app}\{#MyAppLauncherScript}"""; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppIconFile}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{#MyAppLauncherHost}"; Parameters: """{app}\{#MyAppLauncherScript}"""; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppIconFile}"; Tasks: desktopicon

[Run]
Filename: "{#MyAppLauncherHost}"; Parameters: """{app}\{#MyAppLauncherScript}"""; WorkingDir: "{app}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
