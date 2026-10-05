param([string]$Output)
$ErrorActionPreference = 'Stop'
# 只结束插件自己启动的面板，绝不结束其他 PowerShell 或 Codex 进程。
$before = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'bilibili-audio[\\/]0\.3\.4[\\/]panel[\\/]panel\.ps1'
})
if ($before.Count -ne 1) { throw "预期唯一安装版面板，实际 $($before.Count) 个；不执行结束操作" }
$panel = $before[0]
$owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($panel.ParentProcessId)"
if ($owner.Name -ne 'node.exe' -or $owner.CommandLine -notmatch 'bilibili-audio[\\/]0\.3\.4[\\/]server[\\/]index\.mjs') {
    throw '面板父进程不属于待测插件；不执行结束操作'
}
$start = Get-Date
Stop-Process -Id $panel.ProcessId -Force
$observed = @()
$replacement = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $matches = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'powershell.exe' -and $_.ParentProcessId -eq $owner.ProcessId -and $_.CommandLine -eq $panel.CommandLine
    })
    $observed += [pscustomobject]@{ elapsed_seconds = [math]::Round(((Get-Date)-$start).TotalSeconds, 2); pids = @($matches.ProcessId) }
    if ($matches.Count -eq 1) { $replacement = $matches[0]; break }
}
if ($replacement) { Start-Sleep -Seconds 5 }
$stable = if ($replacement) { Get-Process -Id $replacement.ProcessId -ErrorAction SilentlyContinue } else { $null }
$ownerAlive = Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue
$result = [ordered]@{
    tested_at = $start.ToString('o'); target = '已安装 0.3.4，非 UI 进程观察'
    original_pid = $panel.ProcessId; owner_pid = $owner.ProcessId
    replacement_pid = if ($replacement) { $replacement.ProcessId } else { $null }
    passed = [bool]($stable -and $ownerAlive); samples = $observed
    limitation = '证明自动重启的面板进程持续存活；没有证明窗口显示或按钮交互'
}
if ($Output) {
    $destination = [IO.Path]::GetFullPath($Output)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $destination -Encoding utf8
}
$result | ConvertTo-Json -Depth 5
if (-not $result.passed) { exit 1 }
