#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Check', 'Install', 'Remove')][string]$Mode,
    [Parameter(Mandatory)][string]$Root,
    [string]$CliPath,
    [string]$MpvArchivePath,
    [switch]$Isolated
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$pluginId = 'bilibili-audio@bmp-release'
$statePath = Join-Path $Root 'install-state.json'
$codexHome = if ($Isolated) { Join-Path $Root '.installer-test-home' }
    elseif ($env:CODEX_HOME) { [IO.Path]::GetFullPath($env:CODEX_HOME) }
    else { Join-Path $env:USERPROFILE '.codex' }

function Find-Codex {
    if ($CliPath) {
        if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) { throw '指定的 Codex CLI 文件不存在。' }
        return [IO.Path]::GetFullPath($CliPath)
    }
    # 优先使用桌面版自带 CLI，不要求用户另装 Node.js 或 npm。
    $desktopBin = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
    $candidates = @(Get-ChildItem -LiteralPath $desktopBin -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'codex.exe' })
    $pathCommand = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($pathCommand) { $candidates += $pathCommand.Source }
    if (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue) {
        $candidates += @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.InstallLocation 'app/resources/codex.exe' })
    }
    $candidates += @(Get-Process -Name codex -ErrorAction SilentlyContinue |
        ForEach-Object { try { $_.Path } catch {} })
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }
    throw '未找到 Codex CLI。请先安装或更新 Windows Codex 桌面版，然后重新运行安装器。'
}

function Invoke-Codex([string[]]$Arguments) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $script:codexExe
    # Windows 原生进程参数转义；不启动 shell，不拼接 shell 命令。
    $start.Arguments = ($Arguments | ForEach-Object {
        '"' + [regex]::Replace($_, '(\\*)("|$)', {
            param($match)
            ('\' * ($match.Groups[1].Value.Length * 2)) +
                $(if ($match.Groups[2].Value -eq '"') { '\"' } else { '' })
        }) + '"'
    }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['CODEX_HOME'] = $script:codexHome
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) {
            $process.Kill()
            throw 'Codex 插件命令超时。'
        }
        $output = $stdout.GetAwaiter().GetResult()
        $errors = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "Codex 插件命令失败：$errors" }
        if ($output.Trim()) { return $output | ConvertFrom-Json }
    } finally { $process.Dispose() }
}

function Assert-HostClosed {
    if (-not $Isolated -and (Get-Process -Name codex -ErrorAction SilentlyContinue)) {
        throw '请完全退出 Codex（包括后台和桌宠），然后重新运行安装或卸载；只关闭主窗口可能仍有后台进程。'
    }
}

function Normalize-Path([string]$Value) {
    if ($Value.StartsWith('\\?\')) { $Value = $Value.Substring(4) }
    return [IO.Path]::GetFullPath($Value).TrimEnd('\')
}

try {
    Assert-HostClosed
    if ($Mode -eq 'Remove') {
        if (-not (Test-Path -LiteralPath $statePath)) {
            [Console]::WriteLine('未完成插件登记，只卸载本目录程序，未修改 Codex 配置。')
            exit 0
        }
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ((Normalize-Path $state.root) -ne $Root -or $state.pluginId -ne $pluginId) {
            throw '安装记录与本目录不一致，未修改 Codex 配置。'
        }
        $codexHome = $state.codexHome
    }
    $codexExe = Find-Codex
    if (-not (Test-Path -LiteralPath $codexHome)) {
        New-Item -ItemType Directory -Path $codexHome -Force | Out-Null
    }
    $installed = @( (Invoke-Codex @('plugin', 'list', '--json')).installed )
    $marketplace = (Invoke-Codex @('plugin', 'marketplace', 'list', '--json')).marketplaces |
        Where-Object name -eq 'bmp-release' | Select-Object -First 1
    if ($marketplace -and (Normalize-Path $marketplace.root) -ne $Root) {
        throw 'bmp-release 已登记在其他目录，当前安装器不会覆盖它。'
    }
    $ours = $installed | Where-Object pluginId -eq $pluginId | Select-Object -First 1
    if ($ours -and (Normalize-Path $ours.marketplaceSource.source) -ne $Root) {
        throw 'bmp-release 已指向其他目录。请通过原安装器处理，当前安装器不会覆盖它。'
    }
    if ($Mode -eq 'Check') {
        [Console]::WriteLine('Codex CLI 与安装前置检查通过。')
        exit 0
    }
    if ($Mode -eq 'Remove') {
        if ($ours) {
            [void](Invoke-Codex @('plugin', 'remove', $pluginId, '--json'))
        }
        if ($marketplace) {
            [void](Invoke-Codex @('plugin', 'marketplace', 'remove', 'bmp-release', '--json'))
        }
        # 不删除 .codex、登录信息、聊天、封面缓存或未来偏好文件。
        [Console]::WriteLine('已移除 BMP 插件登记；用户数据保留。')
        exit 0
    }

    $manifest = Join-Path $Root 'payload-sha256.json'
    foreach ($file in (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)) {
        $path = [IO.Path]::GetFullPath((Join-Path $Root $file.path))
        if (-not $path.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw '安装清单包含越界路径。'
        }
        $stream = [IO.File]::OpenRead($path)
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
        finally { $stream.Dispose(); $hasher.Dispose() }
        if ($hash -ne $file.sha256) {
            throw "安装文件校验失败：$($file.path)"
        }
    }
    # 先取得并校验播放器，再登记插件；下载失败不改 Codex 配置。
    if ($MpvArchivePath -and -not $Isolated) { throw '本地归档参数仅用于隔离验收。' }
    & (Join-Path $Root 'Prepare-Mpv.ps1') -Root $Root -ArchivePath $MpvArchivePath
    $configPath = Join-Path $codexHome 'config.toml'
    $previousConfig = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllBytes($configPath) } else { $null }
    try {
        [void](Invoke-Codex @('plugin', 'marketplace', 'add', $Root, '--json'))
        $added = Invoke-Codex @('plugin', 'add', $pluginId, '--json')
        if (-not $added.installedPath -or -not (Test-Path -LiteralPath (Join-Path $added.installedPath 'mcp.json'))) {
            throw 'Codex 未产生完整的插件安装副本。'
        }
        # 仅迁移此前本项目在默认个人目录中的安装，其他来源的同名插件不动。
        $legacy = $installed | Where-Object pluginId -eq 'bilibili-audio@personal' | Select-Object -First 1
        $legacyPath = Join-Path $env:USERPROFILE '.codex/plugins/bilibili-audio'
        if (-not $Isolated -and $legacy -and $legacy.enabled -and $legacy.source.source -eq 'local' -and
            (Normalize-Path $legacy.source.path) -eq (Normalize-Path $legacyPath)) {
            [void](Invoke-Codex @('plugin', 'remove', 'bilibili-audio@personal', '--json'))
        }
        $state = [ordered]@{ root=$Root; pluginId=$pluginId; codexHome=$codexHome; installedPath=$added.installedPath;
            version=(Get-Content -LiteralPath (Join-Path $Root 'plugins/bilibili-audio/plugin.json') -Raw | ConvertFrom-Json).version;
            isolated=[bool]$Isolated }
        [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        [Console]::WriteLine('BMP 已安装。请重新打开 Codex 并在新聊天中点歌。')
    } catch {
        # CLI 操作失败时恢复原配置；已复制的程序留在安装目录，便于重试／卸载。
        if (-not $ours) {
            try { [void](Invoke-Codex @('plugin', 'remove', $pluginId, '--json')) } catch {}
            try { [void](Invoke-Codex @('plugin', 'marketplace', 'remove', 'bmp-release', '--json')) } catch {}
        }
        if ($null -ne $previousConfig) { [IO.File]::WriteAllBytes($configPath, $previousConfig) }
        elseif (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath }
        throw
    }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
