param([Parameter(Mandatory=$true)][string]$PipeName)

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading.Tasks;
public static class PanelPipe {
    public static Task<string> SendAsync(string pipeName, string request) {
        return Task.Run(() => {
            using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut)) {
                pipe.Connect(1500);
                using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true))
                using (var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 1024, true)) {
                    writer.WriteLine(request);
                    writer.Flush();
                    return reader.ReadLine();
                }
            }
        });
    }
}
'@

$created = $false
$mutex = [System.Threading.Mutex]::new($true, "Local\BMP-Panel-$PipeName", [ref]$created)
if (-not $created) { $mutex.Dispose(); exit 0 }

function Find-CodexWindow {
    $main = Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -match 'OpenAI[.\\]Codex' -and $_.CommandLine -notmatch '--type=' } |
        Select-Object -First 1
    if ($null -eq $main) { return $null }
    $process = Get-Process -Id $main.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    $process.Refresh()
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { return $null }
    return $process
}

$codex = Find-CodexWindow
if ($null -eq $codex) { $mutex.ReleaseMutex(); $mutex.Dispose(); exit 0 }
$codexPid = $codex.Id

function Invoke-Control([string]$Method, [object[]]$Parameters = @()) {
    $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $pipe.Connect(1500)
        $writer = [System.IO.StreamWriter]::new($pipe, [System.Text.UTF8Encoding]::new($false), 1024, $true)
        $reader = [System.IO.StreamReader]::new($pipe, [System.Text.UTF8Encoding]::new($false), $false, 1024, $true)
        try {
            $request = @{ method = $Method; args = @($Parameters) } | ConvertTo-Json -Compress -Depth 6
            $writer.WriteLine($request)
            $writer.Flush()
            $reply = $reader.ReadLine() | ConvertFrom-Json
            if (-not $reply.ok) { throw $reply.error }
            return $reply.data
        } finally { $writer.Dispose(); $reader.Dispose() }
    } finally { $pipe.Dispose() }
}

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="B 站音频"
        Width="378" Height="254" WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" ResizeMode="NoResize" ShowInTaskbar="False" Topmost="True">
  <Grid>
  <Border Name="ExpandedPanel" CornerRadius="18" Background="#FFF7F8FC" BorderBrush="#FF636B87" BorderThickness="1.5" Padding="14">
    <Border.Effect><DropShadowEffect Color="#44000000" BlurRadius="18" ShadowDepth="4"/></Border.Effect>
    <Grid>
      <Grid.RowDefinitions><RowDefinition Height="30"/><RowDefinition Height="30"/><RowDefinition Height="*"/><RowDefinition Height="48"/></Grid.RowDefinitions>
      <TextBlock Name="Title" Grid.Row="0" Text="B 站音频" FontSize="16" FontWeight="SemiBold" Foreground="#FF20243B"/>
      <Button Name="Collapse" Grid.Row="0" Content="−" Width="26" Height="25" HorizontalAlignment="Right" ToolTip="收起为悬浮球"/>
      <TextBlock Name="Status" Grid.Row="1" Text="正在连接播放器…" FontSize="12" Foreground="#FF50566D" TextTrimming="CharacterEllipsis"/>
      <UniformGrid Grid.Row="2" Rows="2" Columns="3">
        <Button Name="Single" Content="单曲循环" Margin="3"/>
        <Button Name="Sequential" Content="顺序播放" Margin="3"/>
        <Button Name="Preference" Content="偏好查看" Margin="3" IsEnabled="False" ToolTip="偏好功能将在 I-03 中实现"/>
        <Button Name="Pause" Content="暂停" Margin="3"/>
        <Button Name="Previous" Content="上一首" Margin="3"/>
        <Button Name="Next" Content="下一首" Margin="3"/>
      </UniformGrid>
      <Grid Grid.Row="3" Margin="3,8,3,0">
        <Grid.ColumnDefinitions><ColumnDefinition Width="42"/><ColumnDefinition Width="*"/><ColumnDefinition Width="42"/></Grid.ColumnDefinitions>
        <TextBlock Grid.Column="0" Text="音量" VerticalAlignment="Center" FontSize="12" Foreground="#FF50566D"/>
        <Slider Name="Volume" Grid.Column="1" Minimum="0" Maximum="100" Value="100" TickFrequency="1" Focusable="True"
                SmallChange="1" LargeChange="10" IsSnapToTickEnabled="True" IsEnabled="False"
                VerticalAlignment="Center" ToolTip="左右方向键每次调整 1%"/>
        <TextBlock Name="VolumeValue" Grid.Column="2" Text="--%" TextAlignment="Right" VerticalAlignment="Center"
                   FontSize="12" Foreground="#FF50566D"/>
      </Grid>
    </Grid>
  </Border>
  <Border Name="CollapsedBall" Width="62" Height="62" CornerRadius="31" Background="#FF0D5D85"
          BorderBrush="#FF083D5B" BorderThickness="2" Visibility="Collapsed" ToolTip="点击展开；拖动移动">
    <TextBlock Text="♫" FontSize="29" Foreground="White" HorizontalAlignment="Center" VerticalAlignment="Center"/>
  </Border>
  </Grid>
</Window>
'@
$window = [Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($xaml))
$expandedPanel = $window.FindName('ExpandedPanel')
$collapsedBall = $window.FindName('CollapsedBall')
$statusText = $window.FindName('Status')
$title = $window.FindName('Title')
$collapse = $window.FindName('Collapse')
$single = $window.FindName('Single')
$sequential = $window.FindName('Sequential')
$pause = $window.FindName('Pause')
$previous = $window.FindName('Previous')
$next = $window.FindName('Next')
$volume = $window.FindName('Volume')
$volumeValue = $window.FindName('VolumeValue')
$window.Left = [System.Windows.SystemParameters]::WorkArea.Right - $window.Width - 24
$window.Top = [System.Windows.SystemParameters]::WorkArea.Bottom - $window.Height - 24
$title.Add_MouseLeftButtonDown({ if ($_.ChangedButton -eq 'Left') { $window.DragMove() } })
$window.Add_Closing({ if (-not $script:allowClose) { $_.Cancel = $true } })

function Set-PanelCollapsed([bool]$collapsed) {
    $right = $window.Left + $window.Width
    $top = $window.Top
    $workArea = [System.Windows.SystemParameters]::WorkArea
    if ($collapsed) {
        $expandedPanel.Visibility = [System.Windows.Visibility]::Collapsed
        $collapsedBall.Visibility = [System.Windows.Visibility]::Visible
        $window.Width = 62
        $window.Height = 62
    } else {
        $collapsedBall.Visibility = [System.Windows.Visibility]::Collapsed
        $expandedPanel.Visibility = [System.Windows.Visibility]::Visible
        $window.Width = 378
        $window.Height = 254
        Refresh-Panel
    }
    $window.Left = [Math]::Max($workArea.Left, [Math]::Min($right - $window.Width, $workArea.Right - $window.Width))
    $window.Top = [Math]::Max($workArea.Top, [Math]::Min($top, $workArea.Bottom - $window.Height))
}

$collapse.Add_Click({ Set-PanelCollapsed $true })
$collapsedBall.Add_MouseLeftButtonDown({
    $script:ballPress = $_.GetPosition($window)
    $script:ballDragged = $false
    [void]$collapsedBall.CaptureMouse()
})
$collapsedBall.Add_MouseMove({
    if (-not $collapsedBall.IsMouseCaptured -or $_.LeftButton -ne [System.Windows.Input.MouseButtonState]::Pressed) { return }
    $point = $_.GetPosition($window)
    if ([Math]::Abs($point.X - $script:ballPress.X) -gt 5 -or [Math]::Abs($point.Y - $script:ballPress.Y) -gt 5) {
        $script:ballDragged = $true
        $collapsedBall.ReleaseMouseCapture()
        $window.DragMove()
    }
})
$collapsedBall.Add_MouseLeftButtonUp({
    if ($collapsedBall.IsMouseCaptured) { $collapsedBall.ReleaseMouseCapture() }
    if (-not $script:ballDragged) { Set-PanelCollapsed $false }
})

function Refresh-Panel {
    try {
        $state = Invoke-Control 'status'
        $name = if ($null -ne $state.current) { $state.current.title } else { '未播放' }
        $statusText.Text = "$name · $($state.state)"
        $pause.Content = if ($state.state -eq 'paused') { '继续' } else { '暂停' }
        $pause.IsEnabled = $state.state -eq 'playing' -or $state.state -eq 'paused'
        $single.IsEnabled = $true
        $sequential.IsEnabled = $true
        $previous.IsEnabled = $state.history_position -gt 1
        $next.IsEnabled = $state.history_position -lt $state.history_length
        $volume.IsEnabled = $null -ne $state.volume
        if ($null -ne $state.volume -and $null -eq $script:pendingVolume -and -not $volume.IsMouseCaptureWithin) {
            $script:suppressVolumeChange = $true
            try { $volume.Value = [Math]::Max(0, [Math]::Min(100, [int][Math]::Round($state.volume))) }
            finally { $script:suppressVolumeChange = $false }
            $volumeValue.Text = "$([int]$volume.Value)%"
        } elseif ($null -eq $state.volume) { $volumeValue.Text = '--%' }
        $single.Background = if ($state.mode -eq 'single') { '#FFD8E8FF' } else { '#FFFFFFFF' }
        $sequential.Background = if ($state.mode -eq 'sequential') { '#FFD8E8FF' } else { '#FFFFFFFF' }
    } catch {
        $statusText.Text = "连接播放器失败：$($_.Exception.Message)"
        $pause.IsEnabled = $false
        $single.IsEnabled = $false
        $sequential.IsEnabled = $false
        $previous.IsEnabled = $false
        $next.IsEnabled = $false
        $volume.IsEnabled = $false
    }
}

function Run-Action([string]$Method, [object[]]$Parameters = @()) {
    if ($null -ne $script:pendingAction) { return }
    $request = @{ method = $Method; args = @($Parameters) } | ConvertTo-Json -Compress -Depth 6
    $script:pendingAction = [PanelPipe]::SendAsync($PipeName, $request)
    if ($Method -ne 'setVolume') { $statusText.Text = '正在处理…' }
    $single.IsEnabled = $false
    $sequential.IsEnabled = $false
    $pause.IsEnabled = $false
    $previous.IsEnabled = $false
    $next.IsEnabled = $false
    if ($Method -ne 'setVolume') { $volume.IsEnabled = $false }
    $actionTimer.Start()
}

$actionTimer = [System.Windows.Threading.DispatcherTimer]::new()
$actionTimer.Interval = [TimeSpan]::FromMilliseconds(120)
$script:lastVolumeDispatch = [DateTime]::MinValue
$actionTimer.Add_Tick({
    $actionError = $null
    if ($null -ne $script:pendingAction) {
        if (-not $script:pendingAction.IsCompleted) { return }
        try {
            $reply = $script:pendingAction.GetAwaiter().GetResult() | ConvertFrom-Json
            if (-not $reply.ok) { throw $reply.error }
        } catch { $actionError = $_.Exception.Message }
        finally { $script:pendingAction = $null }
    }
    if ($null -ne $script:pendingVolume) {
        if (((Get-Date).ToUniversalTime() - $script:lastVolumeDispatch).TotalMilliseconds -lt 120) { return }
        $value = $script:pendingVolume
        $script:pendingVolume = $null
        $script:lastVolumeDispatch = (Get-Date).ToUniversalTime()
        Run-Action 'setVolume' @($value)
        return
    }
    Refresh-Panel
    if ($actionError) { $statusText.Text = $actionError }
    $actionTimer.Stop()
})

$volume.Add_ValueChanged({
    if ($script:suppressVolumeChange -or -not $volume.IsEnabled) { return }
    $value = [int][Math]::Round($volume.Value)
    $volumeValue.Text = "$value%"
    $script:pendingVolume = $value
    $actionTimer.Start()
})
$volume.Add_PreviewMouseLeftButtonDown({ [void]$volume.Focus() })
$volume.Add_PreviewKeyDown({
    if ($_.Key -eq [System.Windows.Input.Key]::Left) {
        $volume.Value = [Math]::Max(0, $volume.Value - 1)
        $_.Handled = $true
    } elseif ($_.Key -eq [System.Windows.Input.Key]::Right) {
        $volume.Value = [Math]::Min(100, $volume.Value + 1)
        $_.Handled = $true
    }
})

$single.Add_Click({
    $state = Invoke-Control 'status'
    Run-Action 'setMode' @($(if ($state.mode -eq 'single') { 'off' } else { 'single' }))
})
$sequential.Add_Click({
    $state = Invoke-Control 'status'
    Run-Action 'setMode' @($(if ($state.mode -eq 'sequential') { 'off' } else { 'sequential' }))
})
$pause.Add_Click({
    $state = Invoke-Control 'status'
    Run-Action 'setPaused' @($state.state -ne 'paused')
})
$previous.Add_Click({ Run-Action 'previous' })
$next.Add_Click({ Run-Action 'next' })

$missingWindow = 0
$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(2)
$timer.Add_Tick({
    $process = Get-Process -Id $codexPid -ErrorAction SilentlyContinue
    if ($null -ne $process) { $process.Refresh() }
    if ($null -eq $process -or $process.MainWindowHandle -eq [IntPtr]::Zero) { $missingWindow++ }
    else { $missingWindow = 0 }
    if ($missingWindow -ge 3) {
        try { $null = Invoke-Control 'shutdown' } catch {}
        $script:allowClose = $true
        $window.Close()
        return
    }
    if ($null -eq $script:pendingAction -and $null -eq $script:pendingVolume) { Refresh-Panel }
})
$window.Add_Closed({ $timer.Stop(); $actionTimer.Stop(); $mutex.ReleaseMutex(); $mutex.Dispose() })
Refresh-Panel
$timer.Start()
$null = $window.ShowDialog()
