param([string]$PanelScript = "$PSScriptRoot\..\..\plugins\bilibili-audio\panel\panel.ps1")
$ErrorActionPreference = 'Stop'
# 从产品脚本提取原始 Tick 处理器，在同样的 .NET EventHandler 调用范围内测试。
# 不打开窗口、不操作 Codex、不向真实控制管道发送命令。
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $PanelScript).Path, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw '产品面板脚本有语法错误' }
$calls = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
    $node.Expression -is [Management.Automation.Language.VariableExpressionAst] -and
    $node.Expression.VariablePath.UserPath -eq 'timer' -and $node.Member.Value -eq 'Add_Tick'
}, $true))
if ($calls.Count -ne 1) { throw '无法唯一定位生命周期 Tick 回调' }
$literal = $calls[0].Arguments[0].Extent.Text.Trim()
if (-not $literal.StartsWith('{') -or -not $literal.EndsWith('}')) { throw 'Tick 参数不是直接脚本块' }
$callback = [EventHandler][ScriptBlock]::Create($literal.Substring(1, $literal.Length-2))

$script:shutdownCalls = 0
$script:refreshCalls = 0
$script:guiPresent = $false
$missingWindow = 0
$script:missingWindow = 0
$codexPid = -1
$HostProcessId = -1
$script:missingHost = 0
$script:pendingAction = $null
$script:pendingVolume = $null
$script:allowClose = $false
$window = [pscustomobject]@{ Closed=$false }
$window | Add-Member ScriptMethod Close { $this.Closed=$true }
$fakeGui = [pscustomobject]@{ MainWindowHandle=[IntPtr]::Zero }
$fakeGui | Add-Member ScriptMethod Refresh {}
function Get-Process { param($Id, $ErrorAction) if ($script:guiPresent) { return $fakeGui } }
function Invoke-Control { param($Method) if ($Method -eq 'shutdown') { $script:shutdownCalls++ } }
function Refresh-Panel { $script:refreshCalls++ }

# 后台存活但无 GUI 句柄时不关闭；短暂缺失后恢复要重新累计三次。
$script:guiPresent = $true
1..4 | ForEach-Object { $callback.Invoke($null, [EventArgs]::Empty) }
if ($window.Closed -or $script:shutdownCalls) { throw '后台仍存在时不应因无窗口关闭' }
$script:guiPresent = $false
1..2 | ForEach-Object { $callback.Invoke($null, [EventArgs]::Empty) }
if ($window.Closed -or $script:shutdownCalls) { throw '未达到三次缺失时不应关闭' }
$script:guiPresent = $true
$callback.Invoke($null, [EventArgs]::Empty)
$script:guiPresent = $false
1..2 | ForEach-Object { $callback.Invoke($null, [EventArgs]::Empty) }
if ($window.Closed -or $script:shutdownCalls) { throw '后台恢复后应重新累计三次' }
$callback.Invoke($null, [EventArgs]::Empty)
[pscustomobject]@{ shutdown_calls=$script:shutdownCalls; window_closed=$window.Closed; accumulated_missing=$script:missingHost } | ConvertTo-Json
if ($script:shutdownCalls -ne 1 -or -not $window.Closed) { throw '连续三次后台进程缺失后，应发出 shutdown 并关闭面板' }
Write-Output 'PASS: GUI 关闭不退出，后台缺失三次才关闭，恢复后重新计数'
