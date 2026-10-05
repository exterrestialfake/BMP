param(
    [int]$Seconds = 180,
    [string]$Output = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'bmp-lifecycle.json')
)
$ErrorActionPreference = 'Stop'
if ($Seconds -lt 5 -or $Seconds -gt 3600) { throw '观察时间应为 5–3600 秒' }
$destination = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
$samples = @()
$deadline = (Get-Date).AddSeconds($Seconds)
$bmpProfile = [Environment]::GetFolderPath('UserProfile').ToLowerInvariant()
$bmpHash = [Security.Cryptography.SHA256]::Create()
try { $bmpUser = ([BitConverter]::ToString($bmpHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($bmpProfile)))).Replace('-','').ToLowerInvariant().Substring(0,20) }
finally { $bmpHash.Dispose() }
$bmpPipeName = "bilibili-audio-control-v1-$bmpUser"
function Read-BmpPlayback {
    $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $bmpPipeName, [IO.Pipes.PipeDirection]::InOut)
    $reader = $null
    $writer = $null
    try {
        $pipe.Connect(300)
        $reader = [IO.StreamReader]::new($pipe, [Text.Encoding]::UTF8)
        $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false))
        $writer.AutoFlush = $true
        $writer.WriteLine('{"method":"status","args":[]}')
        $pending = $reader.ReadLineAsync()
        if (-not $pending.Wait(1000)) { return [pscustomobject]@{ error='状态读取超时' } }
        $reply = $pending.Result | ConvertFrom-Json
        if ($reply.ok) { return $reply.data }
        return [pscustomobject]@{ error=$reply.error }
    } catch { return [pscustomobject]@{ error=$_.Exception.Message } }
    finally {
        if ($reader) { $reader.Dispose() }
        if ($writer) { try { $writer.Dispose() } catch {} }
        $pipe.Dispose()
    }
}
# 独立观察器不控制任何窗口、播放器或应用；每轮落盘，Codex 退出后仍可记录。
do {
    $processes = @(Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -match 'OpenAI.Codex' -and $_.CommandLine -notmatch '--type=') -or
        ($_.Name -eq 'codex.exe' -and $_.CommandLine -match '\bapp-server\b') -or
        ($_.Name -in @('node.exe','powershell.exe','mpv.exe') -and $_.CommandLine -match 'bilibili-audio')
    })
    $samples += [pscustomobject]@{
        time = (Get-Date).ToString('o')
        playback = Read-BmpPlayback
        processes = @($processes | ForEach-Object {
            $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
            [pscustomobject]@{ pid=$_.ProcessId; parent=$_.ParentProcessId; name=$_.Name; command=$_.CommandLine; main_window_handle=if($p){$p.MainWindowHandle.ToInt64()}else{$null} }
        })
    }
    [pscustomobject]@{ started_at=$samples[0].time; observer_pid=$PID; finished=(Get-Date) -ge $deadline; samples=$samples } |
        ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $destination -Encoding utf8
    if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
} while ((Get-Date) -lt $deadline)
[pscustomobject]@{ started_at=$samples[0].time; observer_pid=$PID; finished=$true; samples=$samples } |
    ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $destination -Encoding utf8
