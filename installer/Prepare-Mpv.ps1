#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Root,
    [string]$ArchivePath
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$url = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260926/mpv-x86_64-20260926-git-35af06172b.7z'
$archiveHash = 'a9aaf0cff587473551199a30db717d92c4f75fd06fa64c2e9689800e48f48939'
$files = [ordered]@{
    'mpv.exe' = 'df33d979a67ed25253c2b3b4382904244e6914fb42b2994118fb0694fcfcb384'
    'd3dcompiler_43.dll' = '4b074a3976399dc735484f5d43d04b519b7bdee8ac719d9ab8ed6bd4e6be0345'
    'mpv/fonts.conf' = 'f141c1b89b172d22f213531646c21e288f0ebf3ec46484698896e1b33c626756'
}
$destination = Join-Path $Root 'plugins/bilibili-audio/vendor/mpv'

function File-Hash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Matches([string]$Directory) {
    foreach ($name in $files.Keys) {
        $path = Join-Path $Directory $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (File-Hash $path) -ne $files[$name]) { return $false }
    }
    return $true
}

# 只复用这三个版本固定、哈希正确的文件；不接受 PATH 中任意同名播放器。
if ((-not $ArchivePath) -and (Matches $destination)) {
    Write-Output 'mpv 文件校验通过，复用已下载的版本。'
    return
}
$temporary = Join-Path $Root ('.mpv-download-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
try {
    if ($ArchivePath) { $archive = [IO.Path]::GetFullPath($ArchivePath) }
    else {
        $archive = Join-Path $temporary 'mpv.7z'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        for ($attempt = 1; $attempt -le 2; $attempt++) {
            try {
                Write-Output '正在从 mpv 上游下载固定版本（约 33 MB）……'
                $previousProgress = $ProgressPreference
                try {
                    $ProgressPreference = 'SilentlyContinue'
                    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing -TimeoutSec 120
                } finally { $ProgressPreference = $previousProgress }
                break
            } catch {
                if ($attempt -eq 2) { throw 'mpv 上游下载失败。请检查网络后重新运行安装器；尚未登记插件。' }
            }
        }
    }
    if ((File-Hash $archive) -ne $archiveHash) { throw 'mpv 归档 SHA256 不匹配，拒绝安装。' }
    $extracted = Join-Path $temporary 'extracted'
    New-Item -ItemType Directory -Path $extracted -Force | Out-Null
    # 校验固定归档后才解压；只取播放器运行所需的三个文件，不执行上游脚本。
    $tar = Join-Path $env:WINDIR 'System32/tar.exe'
    & $tar -xf $archive -C $extracted @($files.Keys)
    if ($LASTEXITCODE -ne 0) { throw 'mpv 解压失败。请更新 Windows 的 tar（需支持 7z）后重试。' }
    if (-not (Matches $extracted)) { throw 'mpv 解压文件校验失败，拒绝安装。' }
    foreach ($name in $files.Keys) {
        $target = Join-Path $destination $name
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $extracted $name) -Destination $target -Force
    }
    if (-not (Matches $destination)) { throw 'mpv 落盘校验失败，拒绝登记插件。' }
    Write-Output 'mpv 已从上游取得；归档和三个运行文件的 SHA256 校验通过。'
} finally {
    $resolvedTemporary = [IO.Path]::GetFullPath($temporary)
    if (-not $resolvedTemporary.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '临时目录清理路径越界。' }
    if (Test-Path -LiteralPath $resolvedTemporary) { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force }
}
