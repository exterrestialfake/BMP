#ifndef Version
  #error Version is required
#endif
#ifndef Payload
  #error Payload is required
#endif

[Setup]
AppId={code:InstallerId}
AppName=Bilibili as Music Player
AppVersion={#Version}
AppVerName=Bilibili as Music Player {#Version}
AppCopyright=Copyright (c) 2026 BMP contributors
DefaultDirName={localappdata}\Programs\BMP
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UsePreviousAppDir=no
UsePreviousLanguage=no
DisableProgramGroupPage=yes
DisableDirPage=yes
OutputDir=..\release
OutputBaseFilename=BMP-Setup-{#Version}-windows-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayName=Bilibili as Music Player
UninstallFilesDir={app}\uninstall
InfoBeforeFile=Setup-info.txt
LicenseFile={#Payload}\plugins\bilibili-audio\THIRD_PARTY_NOTICES.txt

[Files]
Source: "Integrate-Codex.ps1"; Flags: dontcopy
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Integrate-Codex.ps1"; DestDir: "{app}"; Flags: ignoreversion; AfterInstall: Integrate

[UninstallDelete]
Type: files; Name: "{app}\install-state.json"
; 下载文件不在 Inno 的复制记录中，卸载时只删除这三个已知运行文件。
Type: files; Name: "{app}\plugins\bilibili-audio\vendor\mpv\mpv.exe"
Type: files; Name: "{app}\plugins\bilibili-audio\vendor\mpv\d3dcompiler_43.dll"
Type: files; Name: "{app}\plugins\bilibili-audio\vendor\mpv\mpv\fonts.conf"
Type: dirifempty; Name: "{app}\plugins\bilibili-audio\vendor\mpv\mpv"
Type: dirifempty; Name: "{app}\plugins\bilibili-audio\vendor\mpv"

[Code]
var
  IntegrationFailed: Boolean;
  IntegrationError: String;

function Isolated: Boolean;
begin
  Result := ExpandConstant('{param:ISOLATED|0}') = '1';
end;

function InstallerId(Param: String): String;
begin
  Result := 'BMP-bilibili-audio';
  if Isolated then Result := Result + '-isolated';
end;

function RunIntegration(ScriptPath, Mode: String; var Details: String): Boolean;
var
  Args: String;
  Output: TExecOutput;
  ExitCode, I: Integer;
begin
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptPath +
    '" -Mode ' + Mode + ' -Root "' + ExpandConstant('{app}') + '"';
  if Isolated then Args := Args + ' -Isolated';
  if Isolated and (ExpandConstant('{param:MPVARCHIVE|}') <> '') then
    Args := Args + ' -MpvArchivePath "' + ExpandConstant('{param:MPVARCHIVE|}') + '"';
  if ExpandConstant('{param:CODEXCLI|}') <> '' then
    Args := Args + ' -CliPath "' + ExpandConstant('{param:CODEXCLI|}') + '"';
  Result := ExecAndCaptureOutput(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Args, '', SW_HIDE, ewWaitUntilTerminated, ExitCode, Output);
  Details := '';
  for I := 0 to GetArrayLength(Output.StdOut) - 1 do
    Details := Details + Output.StdOut[I] + #13#10;
  for I := 0 to GetArrayLength(Output.StdErr) - 1 do
    Details := Details + Output.StdErr[I] + #13#10;
  Log(Details);
  Result := Result and (ExitCode = 0) and not Output.Error;
  if (not Result) and (Details = '') then
    Details := 'Unable to run the Codex integration check.';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Details: String;
begin
  ExtractTemporaryFile('Integrate-Codex.ps1');
  if not RunIntegration(ExpandConstant('{tmp}\Integrate-Codex.ps1'), 'Check', Details) then
    Result := Details;
end;

procedure Integrate;
var
  Details: String;
begin
  WizardForm.StatusLabel.Caption := 'Downloading and verifying mpv, then registering the Codex plugin...';
  IntegrationFailed := not RunIntegration(ExpandConstant('{app}\Integrate-Codex.ps1'), 'Install', Details);
  if IntegrationFailed then IntegrationError := Details;
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := 0;
  if IntegrationFailed then Result := 10;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and IntegrationFailed then begin
    WizardForm.FinishedHeadingLabel.Caption := 'Codex plugin installation failed';
    WizardForm.FinishedLabel.Caption := IntegrationError + #13#10 +
      'Codex configuration was restored. Retry installation or uninstall BMP.';
  end;
end;

function InitializeUninstall: Boolean;
var
  Details, ScriptPath: String;
begin
  ScriptPath := ExpandConstant('{app}\Integrate-Codex.ps1');
  Result := RunIntegration(ScriptPath, 'Remove', Details);
  if (not Result) and (not UninstallSilent) then MsgBox(Details, mbError, MB_OK);
end;
