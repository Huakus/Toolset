<#
.SYNOPSIS
 Orquesta el lanzamiento de TaleSpire y los workers del Toolset.

.DESCRIPTION
 Este script no hace sync, no exporta hojas, no genera indices y no abre TaleSpire directamente.
 Solo coordina scripts separados:
 - 8_generate-public-file-index.ps1: genera Indice_Archivos.md con URLs publicas de ECE.
 - 5_sync-toolset-git.ps1: mantiene sincronizado el repo Toolset.
 - 4_export-character-sheets.ps1: exporta una hoja TXT por personaje.
 - 7_generate-history-index.ps1: genera Lore\Indice_Historia.md desde Lore\Capitulos.
 - 3_start-talespire.ps1: abre el juego.
 - 6_wait-talespire-close.ps1: espera a que TaleSpire cierre y crea una senal de stop.

 Los workers corren como procesos separados, compartiendo la misma consola.
#>
param(
 [switch]$NoPauseOnError
)

$ErrorActionPreference = 'Stop'

# ============================================================
# Paths base
# ============================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CommonLoggingScript = Join-Path $ScriptDir '0_common-logging.ps1'
. $CommonLoggingScript

Initialize-Logging -ScriptPath $PSCommandPath

# Runtime fuera del repo.
# No debe vivir dentro de .localstorage porque Git sincroniza esa carpeta.
$RuntimeDir = Join-Path $env:TEMP 'talespire-toolset-runtime'
$StopSignalFile = Join-Path $RuntimeDir 'stop-all.signal'

$StartTaleSpireScript = Join-Path $ScriptDir '3_start-talespire.ps1'
$ExportCharacterSheetsScript = Join-Path $ScriptDir '4_export-character-sheets.ps1'
$SyncToolsetScript = Join-Path $ScriptDir '5_sync-toolset-git.ps1'
$WaitTaleSpireCloseScript = Join-Path $ScriptDir '6_wait-talespire-close.ps1'
$GenerateHistoryIndexScript = Join-Path $ScriptDir '7_generate-history-index.ps1'
$GeneratePublicFileIndexScript = Join-Path $ScriptDir '8_generate-public-file-index.ps1'

# ============================================================
# Helpers
# ============================================================

function Wait-BeforeExitOnError {
 if (-not $NoPauseOnError) {
  Write-Host ''
  Write-Log 'Presiona una tecla para cerrar esta ventana...'
  [void][System.Console]::ReadKey($true)
 }
}

function Assert-ScriptExists([string]$Path) {
 if (-not (Test-Path -LiteralPath $Path)) {
  throw "No se encontro el script requerido: $Path"
 }
}

function Quote-Argument([string]$Value) {
 return '"' + ($Value -replace '"', '\"') + '"'
}

function Start-PowerShellWorker {
 param(
  [string]$Title,
  [string]$ScriptPath,
  [string[]]$ExtraArgs = @()
 )

 $args = @(
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  (Quote-Argument $ScriptPath)
 ) + $ExtraArgs

 Write-Log ("Iniciando worker: {0}" -f $Title)

 return Start-Process `
  -FilePath 'powershell.exe' `
  -ArgumentList $args `
  -NoNewWindow `
  -PassThru
}

function Stop-WorkerIfAlive {
 param(
  [System.Diagnostics.Process]$Process,
  [string]$Name
 )

 if ($Process -and -not $Process.HasExited) {
  Write-Log ("Deteniendo worker: {0}" -f $Name)
  $Process.Kill()
  $Process.WaitForExit()
 }
}

function Assert-ProcessExitCodeOk {
 param(
  [System.Diagnostics.Process]$Process,
  [string]$ScriptName
 )

 if (-not $Process) {
  return
 }

 $Process.Refresh()

 if ($null -eq $Process.ExitCode) {
  return
 }

 if ($Process.ExitCode -ne 0) {
  throw "{0} termino con codigo {1}." -f $ScriptName, $Process.ExitCode
 }
}

function Assert-WorkersStillOk {
 param(
  [hashtable[]]$Workers
 )

 foreach ($worker in $Workers) {
  $process = $worker.Process
  $name = $worker.Name

  if (-not $process) {
   continue
  }

  $process.Refresh()

  if ($process.HasExited -and $process.ExitCode -ne 0) {
   throw "{0} termino con codigo {1}." -f $name, $process.ExitCode
  }
 }
}

function Wait-ProcessWithWorkerMonitoring {
 param(
  [System.Diagnostics.Process]$Process,
  [string]$ScriptName,
  [hashtable[]]$Workers = @(),
  [int]$PollSeconds = 2
 )

 while (-not $Process.HasExited) {
  Assert-WorkersStillOk -Workers $Workers
  Start-Sleep -Seconds $PollSeconds
  $Process.Refresh()
 }

 Assert-ProcessExitCodeOk -Process $Process -ScriptName $ScriptName
}

function Invoke-PowerShellOnce {
 param(
  [string]$Title,
  [string]$ScriptPath,
  [string[]]$ExtraArgs = @(),
  [hashtable[]]$Workers = @()
 )

 $process = Start-PowerShellWorker `
  -Title $Title `
  -ScriptPath $ScriptPath `
  -ExtraArgs $ExtraArgs

 Wait-ProcessWithWorkerMonitoring `
  -Process $process `
  -ScriptName ([System.IO.Path]::GetFileName($ScriptPath)) `
  -Workers $Workers
}

# ============================================================
# Flujo principal
# ============================================================

$syncProcess = $null
$exportProcess = $null
$historyIndexProcess = $null

try {
 Assert-ScriptExists $StartTaleSpireScript
 Assert-ScriptExists $ExportCharacterSheetsScript
 Assert-ScriptExists $SyncToolsetScript
 Assert-ScriptExists $WaitTaleSpireCloseScript
 Assert-ScriptExists $GenerateHistoryIndexScript
 Assert-ScriptExists $GeneratePublicFileIndexScript

 if (-not (Test-Path -LiteralPath $RuntimeDir)) {
  [void](New-Item -ItemType Directory -Force -Path $RuntimeDir)
 }

 if (Test-Path -LiteralPath $StopSignalFile) {
  Remove-Item -LiteralPath $StopSignalFile -Force
 }

 $Repo = Split-Path -Parent (Split-Path -Parent $ScriptDir)
 $PublicFileIndexRepo = Join-Path $Repo '.localstorage\ECE'
 $PublicFileIndexRelativePath = 'Indice_Archivos.md'

 # 1. Genera el indice publico una vez antes de iniciar el sync.
 Invoke-PowerShellOnce `
  -Title 'Public File Index Generator' `
  -ScriptPath $GeneratePublicFileIndexScript `
  -ExtraArgs @('-Repo', (Quote-Argument $PublicFileIndexRepo), '-OutputRelativePath', $PublicFileIndexRelativePath)

 # 2. Arranca el sync como worker independiente.
 $syncProcess = Start-PowerShellWorker `
  -Title 'Toolset Git Sync' `
  -ScriptPath $SyncToolsetScript `
  -ExtraArgs @('-StopSignalFile', (Quote-Argument $StopSignalFile), '-NoPauseOnError')

 # 3. Arranca el exportador de hojas como worker independiente.
 $exportProcess = Start-PowerShellWorker `
  -Title 'Character Sheets Export' `
  -ScriptPath $ExportCharacterSheetsScript `
  -ExtraArgs @('-StopSignalFile', (Quote-Argument $StopSignalFile), '-NoPauseOnError', '-Quiet')

 # 4. Arranca el generador de indice de historia como worker independiente.
 $historyIndexProcess = Start-PowerShellWorker `
  -Title 'History Index Generator' `
  -ScriptPath $GenerateHistoryIndexScript `
  -ExtraArgs @('-StopSignalFile', (Quote-Argument $StopSignalFile), '-NoPauseOnError', '-Quiet')

 $backgroundWorkers = @(
  @{ Name = '5_sync-toolset-git.ps1'; Process = $syncProcess },
  @{ Name = '4_export-character-sheets.ps1'; Process = $exportProcess },
  @{ Name = '7_generate-history-index.ps1'; Process = $historyIndexProcess }
 )

 # 5. Abre TaleSpire como script separado.
 $startProcess = Start-PowerShellWorker `
  -Title 'Start TaleSpire' `
  -ScriptPath $StartTaleSpireScript `
  -ExtraArgs @('-NoPauseOnError')

 Wait-ProcessWithWorkerMonitoring `
  -Process $startProcess `
  -ScriptName '3_start-talespire.ps1' `
  -Workers $backgroundWorkers

 # 6. Espera a que TaleSpire cierre.
 # Al cerrar, este worker crea la senal de stop.
 $watchProcess = Start-PowerShellWorker `
  -Title 'Wait TaleSpire Close' `
  -ScriptPath $WaitTaleSpireCloseScript `
  -ExtraArgs @('-StopSignalFile', (Quote-Argument $StopSignalFile), '-NoPauseOnError')

 Wait-ProcessWithWorkerMonitoring `
  -Process $watchProcess `
  -ScriptName '6_wait-talespire-close.ps1' `
  -Workers $backgroundWorkers

 # 7. Espera a que los workers detecten la senal y salgan.
 if ($historyIndexProcess -and -not $historyIndexProcess.HasExited) {
  Write-Log 'Esperando cierre del worker de indice de historia...'
  $historyIndexProcess.WaitForExit()
 }

 if ($exportProcess -and -not $exportProcess.HasExited) {
  Write-Log 'Esperando cierre del worker de hojas...'
  $exportProcess.WaitForExit()
 }


 if ($syncProcess -and -not $syncProcess.HasExited) {
  Write-Log 'Esperando cierre del worker de sync...'
  $syncProcess.WaitForExit()
 }

 Assert-ProcessExitCodeOk -Process $historyIndexProcess -ScriptName '7_generate-history-index.ps1'
 Assert-ProcessExitCodeOk -Process $exportProcess -ScriptName '4_export-character-sheets.ps1'
 Assert-ProcessExitCodeOk -Process $syncProcess -ScriptName '5_sync-toolset-git.ps1'

 # 8. Ultima pasada segura: genera el indice publico despues de exportar/generar indices.
 Invoke-PowerShellOnce `
  -Title 'Public File Index Generator Final' `
  -ScriptPath $GeneratePublicFileIndexScript `
  -ExtraArgs @('-Repo', (Quote-Argument $PublicFileIndexRepo), '-OutputRelativePath', $PublicFileIndexRelativePath)

 # 9. Sync final one-shot para subir el indice publico definitivo.
 Invoke-PowerShellOnce `
  -Title 'Toolset Git Sync Final' `
  -ScriptPath $SyncToolsetScript `
  -ExtraArgs @('-StopSignalFile', (Quote-Argument $StopSignalFile), '-NoPauseOnError')

 Write-Log 'OK: TaleSpire cerrado. Workers finalizados correctamente.'
 Start-Sleep -Seconds 2
 exit 0
}
catch {
 $errorMessage = "ERROR: {0}" -f $_.Exception.Message
 Write-Log $errorMessage -Color 'Red'
 Show-ErrorAlert $errorMessage

 if (-not (Test-Path -LiteralPath $StopSignalFile)) {
  try {
   [void](New-Item -ItemType File -Force -Path $StopSignalFile)
  }
  catch {}
 }

 Stop-WorkerIfAlive -Process $historyIndexProcess -Name 'History Index Generator'
 Stop-WorkerIfAlive -Process $exportProcess -Name 'Character Sheets Export'
 Stop-WorkerIfAlive -Process $syncProcess -Name 'Toolset Git Sync'

 Wait-BeforeExitOnError
 exit 1
}
finally {
 try {
  if (Test-Path -LiteralPath $StopSignalFile) {
   Remove-Item -LiteralPath $StopSignalFile -Force -ErrorAction SilentlyContinue
  }
 }
 catch {}
}
