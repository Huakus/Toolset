<#
.SYNOPSIS
 Instala una compilacion V2 preparada antes de abrir TaleSpire.
#>
param(
 [switch]$NoPauseOnError,
 [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir '0_common-logging.ps1')
Initialize-Logging -ScriptPath $PSCommandPath

$Repo = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$PendingDir = Join-Path $Repo 'dist-v2-pending'
$ActiveDir = Join-Path $Repo 'dist-v2'

try {
 if (-not (Test-Path -LiteralPath (Join-Path $PendingDir 'v2.html'))) {
  if (-not $Quiet) { Write-Log 'No hay una compilacion V2 pendiente.' }
  exit 0
 }
 if (Get-Process -Name 'TaleSpire' -ErrorAction SilentlyContinue) {
  throw 'TaleSpire esta abierto y mantiene la compilacion activa bloqueada.'
 }
 if (-not (Test-Path -LiteralPath $ActiveDir)) { New-Item -ItemType Directory -Path $ActiveDir -Force | Out-Null }
 Copy-Item -Path (Join-Path $PendingDir '*') -Destination $ActiveDir -Recurse -Force
 Write-Log 'Compilacion V2 pendiente instalada correctamente.'
 exit 0
}
catch {
 $message = "ERROR instalando la compilacion V2: $($_.Exception.Message)"
 Write-Log $message -Color 'Red'
 if (-not $NoPauseOnError) { Show-ErrorAlert $message }
 exit 1
}
