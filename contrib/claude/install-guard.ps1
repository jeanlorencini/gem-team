param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'gem-orchestrator-tool-guard.js'
$root = [IO.Path]::GetFullPath($ProjectRoot)
if (!(Test-Path -LiteralPath $root -PathType Container)) { throw 'ProjectRoot must exist' }
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js must be available on PATH' }
$hookDir = Join-Path $root '.claude\hooks'
$settings = Join-Path $root '.claude\settings.local.json'
$hookPath = Join-Path $hookDir 'gem-orchestrator-tool-guard.js'
$backupDir = Join-Path $env:USERPROFILE '.claude\backups'
[IO.Directory]::CreateDirectory($hookDir) | Out-Null
[IO.Directory]::CreateDirectory($backupDir) | Out-Null
$settingsExists = Test-Path -LiteralPath $settings
$hookExists = Test-Path -LiteralPath $hookPath
$settingsOld = if ($settingsExists) { [IO.File]::ReadAllBytes($settings) } else { $null }
$hookOld = if ($hookExists) { [IO.File]::ReadAllBytes($hookPath) } else { $null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ($settingsExists) { [IO.File]::WriteAllBytes((Join-Path $backupDir "gem-guard-settings-$stamp.json"), $settingsOld) }
if ($hookExists) { [IO.File]::WriteAllBytes((Join-Path $backupDir "gem-guard-hook-$stamp.js"), $hookOld) }
try {
  $cfg = if ($settingsExists) { Get-Content -Raw -LiteralPath $settings -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
  if (!$cfg.PSObject.Properties['hooks']) { $cfg | Add-Member -MemberType NoteProperty -Name hooks -Value ([pscustomobject]@{}) }
  if (!$cfg.hooks.PSObject.Properties['PreToolUse']) { $cfg.hooks | Add-Member -MemberType NoteProperty -Name PreToolUse -Value @() }
  $entries = @($cfg.hooks.PreToolUse)
  $found = $false
  foreach ($entry in $entries) {
    foreach ($hook in @($entry.hooks)) {
      if ($hook.type -eq 'command' -and $hook.command -eq 'node' -and @($hook.args) -contains $hookPath) {
        $hook.timeout = 10
        $hook.onFailure = 'block'
        $found = $true
      }
    }
  }
  if (!$found) {
    $entries += [pscustomobject]@{
      matcher = '*'
      hooks = @([pscustomobject]@{ type='command'; command='node'; args=@($hookPath); timeout=10; onFailure='block' })
    }
  }
  $cfg.hooks.PreToolUse = @($entries)
  Copy-Item -LiteralPath $source -Destination $hookPath -Force
  [IO.File]::WriteAllText($settings,($cfg | ConvertTo-Json -Depth 50),(New-Object Text.UTF8Encoding($false)))
  $verify = Get-Content -Raw -LiteralPath $settings -Encoding UTF8 | ConvertFrom-Json
  $matching = @($verify.hooks.PreToolUse | ForEach-Object { $_.hooks } | Where-Object { $_.command -eq 'node' -and @($_.args) -contains $hookPath })
  if ($matching.Count -ne 1 -or $matching[0].timeout -ne 10 -or $matching[0].onFailure -ne 'block') { throw 'Installed hook configuration failed validation' }
  Write-Output "Installed guard at $hookPath"
  Write-Output "Updated $settings"
} catch {
  if ($settingsExists) { [IO.File]::WriteAllBytes($settings,$settingsOld) } elseif (Test-Path $settings) { Remove-Item -LiteralPath $settings -Force }
  if ($hookExists) { [IO.File]::WriteAllBytes($hookPath,$hookOld) } elseif (Test-Path $hookPath) { Remove-Item -LiteralPath $hookPath -Force }
  throw
}