# Shared by the disposable local launcher and CI; never wait for the worker's descendants.
function Stop-LifecycleProcess([Diagnostics.Process] $Process) {
  if ($null -eq $Process -or -not $Process.Id) { return }
  try {
    if (-not $Process.HasExited) {
      Write-Host "Stopping owned lifecycle process tree pid=$($Process.Id)"
      & taskkill.exe /PID $Process.Id /T /F | Out-Host
      if ($LASTEXITCODE -ne 0 -and -not $Process.HasExited) { throw "Could not stop owned process $($Process.Id)." }
      if (-not $Process.WaitForExit(10000)) { throw "Owned process $($Process.Id) did not stop." }
    }
  }
  finally { $Process.Dispose() }
}

function Wait-LifecycleWorker(
  [Diagnostics.Process] $Worker,
  [string] $Stage,
  [int] $TimeoutSeconds = 480
) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $nextReport = 0
  try {
    while (-not $Worker.WaitForExit(250)) {
      if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        throw "Lifecycle worker pid=$($Worker.Id) timed out after $TimeoutSeconds seconds."
      }
      if ($clock.Elapsed.TotalSeconds -ge $nextReport) {
        Write-Host "Lifecycle worker pid=$($Worker.Id) running elapsed=$([int]$clock.Elapsed.TotalSeconds)s"
        Get-Content -LiteralPath (Join-Path $Stage 'results\lifecycle.log') -Tail 4 -ErrorAction SilentlyContinue | Out-Host
        $nextReport = $clock.Elapsed.TotalSeconds + 15
      }
    }
    $Worker.Refresh()
    Write-Host "Lifecycle worker pid=$($Worker.Id) exited code=$($Worker.ExitCode)"
    if ($null -ne $Worker.ExitCode -and $Worker.ExitCode -ne 0) {
      throw "Installer lifecycle worker exited $($Worker.ExitCode)."
    }
    # A missing, partial or failed journal can never substitute for completion.
    $summary = Get-Content -LiteralPath (Join-Path $Stage 'results\summary.json') -Raw | ConvertFrom-Json
    if ($summary.succeeded -cne $true) { throw "Installer lifecycle checks failed: $($summary.failure)" }
    $postflight = Get-Content -LiteralPath (Join-Path $Stage 'results\postflight.json') -Raw | ConvertFrom-Json
    if ($postflight.Passed -cne $true) { throw 'Installer lifecycle postflight did not pass.' }
  }
  finally {
    try {
      if (-not $Worker.HasExited) {
        Get-CimInstance Win32_Process -Filter "ProcessId=$($Worker.Id) OR ParentProcessId=$($Worker.Id)" |
          Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate |
          ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Stage 'worker-timeout-processes.json')
      }
      foreach ($name in @('worker.stdout.log', 'worker.stderr.log')) {
        Get-Content -LiteralPath (Join-Path $Stage $name) -ErrorAction SilentlyContinue | Out-Host
      }
    }
    finally { Stop-LifecycleProcess $Worker }
  }
}
