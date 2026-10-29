; Lumen installer (Inno Setup 6). Built by .github/workflows/release.yml:
;   iscc /DAppVersion=1.7.0 /DArch=x64 /DSourceDir=..\stage\x64 installer\lumen.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Arch
  #define Arch "x64"
#endif
#ifndef SourceDir
  #define SourceDir "..\stage\" + Arch
#endif

[Setup]
AppId={{6E1F2A35-8C4B-4D1E-9A7B-1C2D3E4F5A6B}
AppName=Lumen
AppVersion={#AppVersion}
AppVerName=Lumen {#AppVersion}
AppPublisher=Shane Sahadeo
AppPublisherURL=https://github.com/shenvecthor/lumen
AppSupportURL=https://github.com/shenvecthor/lumen/issues
AppUpdatesURL=https://github.com/shenvecthor/lumen/releases
AppCopyright=© 2026 Shane Sahadeo
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany=Shane Sahadeo
VersionInfoDescription=Lumen setup
DefaultDirName={autopf}\Lumen
DefaultGroupName=Lumen
DisableProgramGroupPage=yes
DisableWelcomePage=no
; per-user by default (no admin prompt); "Install for all users" is offered too
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
MinVersion=10.0
OutputDir=..\out
OutputBaseFilename=Lumen-Setup-{#AppVersion}-{#Arch}
SetupIconFile=..\lumen.ico
UninstallDisplayIcon={app}\Lumen.exe
UninstallDisplayName=Lumen
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "openwith"; Description: "Add Lumen to ""Open with"" for video and audio files"; GroupDescription: "Files:"

[Files]
Source: "{#SourceDir}\Lumen.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\engine\*"; DestDir: "{app}\engine"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\README.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "{#SourceDir}\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; an engine from an older version is replaced as a whole
Type: filesandordirs; Name: "{app}\engine"

[Icons]
Name: "{autoprograms}\Lumen"; Filename: "{app}\Lumen.exe"; Comment: "Lightweight, modern media player"
Name: "{autodesktop}\Lumen"; Filename: "{app}\Lumen.exe"; Tasks: desktopicon

[Registry]
; "Open with" and Windows Default Apps registration (no defaults are changed; Windows lets you pick)
Root: HKA; Subkey: "Software\Classes\Lumen.Media"; ValueType: string; ValueData: "Media file (Lumen)"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Lumen.Media\DefaultIcon"; ValueType: string; ValueData: "{app}\Lumen.exe,0"
Root: HKA; Subkey: "Software\Classes\Lumen.Media\shell\open\command"; ValueType: string; ValueData: """{app}\Lumen.exe"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Lumen.Media\shell\open"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Lumen"
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Lumen"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\shell\open\command"; ValueType: string; ValueData: """{app}\Lumen.exe"" ""%1"""
Root: HKA; Subkey: "Software\Lumen\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Lumen"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Lumen\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Lightweight, modern media player"
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Lumen"; ValueData: "Software\Lumen\Capabilities"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mp4"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mp4\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mp4"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".m4v"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.m4v\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".m4v"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mkv"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mkv\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mkv"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".webm"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.webm\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".webm"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mov"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mov\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mov"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".avi"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.avi\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".avi"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".divx"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.divx\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".divx"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".wmv"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.wmv\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".wmv"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".asf"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.asf\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".asf"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".flv"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.flv\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".flv"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".f4v"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.f4v\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".f4v"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mpg"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mpg\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mpg"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mpeg"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mpeg\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mpeg"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".vob"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.vob\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".vob"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".ts"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.ts\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ts"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".m2ts"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.m2ts\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".m2ts"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mts"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mts\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mts"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".3gp"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.3gp\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".3gp"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".3g2"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.3g2\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".3g2"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".ogv"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.ogv\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ogv"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".rm"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.rm\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".rm"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".rmvb"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.rmvb\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".rmvb"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mxf"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mxf\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mxf"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mp3"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mp3\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mp3"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".m4a"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.m4a\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".m4a"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".aac"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.aac\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".aac"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".flac"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.flac\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".flac"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".wav"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.wav\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".wav"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".ogg"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.ogg\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ogg"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".oga"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.oga\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".oga"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".opus"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.opus\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".opus"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".weba"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.weba\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".weba"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mka"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mka\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mka"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".wma"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.wma\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".wma"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".ac3"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.ac3\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ac3"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".eac3"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.eac3\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".eac3"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".dts"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.dts\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".dts"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".ape"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.ape\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ape"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".wv"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.wv\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".wv"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".tta"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.tta\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".tta"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".mpc"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.mpc\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mpc"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".aiff"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.aiff\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".aiff"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".aif"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.aif\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".aif"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".amr"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.amr\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".amr"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".caf"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.caf\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".caf"; ValueData: "Lumen.Media"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Applications\Lumen.exe\SupportedTypes"; ValueType: string; ValueName: ".dsf"; ValueData: ""; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\.dsf\OpenWithProgids"; ValueType: string; ValueName: "Lumen.Media"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Lumen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".dsf"; ValueData: "Lumen.Media"; Tasks: openwith

[Run]
Filename: "{app}\Lumen.exe"; Description: "Start Lumen"; Flags: nowait postinstall skipifsilent

[Code]
// Settings live in %LOCALAPPDATA%\Lumen; uninstalling asks whether to keep them.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and DirExists(ExpandConstant('{localappdata}\Lumen')) and not UninstallSilent then
    if MsgBox('Also remove your Lumen settings and favorites?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{localappdata}\Lumen'), True, True, True);
end;
