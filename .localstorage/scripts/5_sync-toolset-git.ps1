<#
.SYNOPSIS
 Sincroniza exclusivamente el estado de campaña y la publicación ECE.

.DESCRIPTION
 Worker transitorio mientras Git siga siendo el transporte entre jugadores.
 Nunca agrega todo el repositorio, no modifica remotos y no incorpora cambios
 de código durante una partida. Valida el blob V2 antes y después del sync.
#>
param(
 [Parameter(Mandatory = $true)] [string]$StopSignalFile,
 [string]$CampaignFileName = 'd8383957-1a6b-4719-9b68-797f03145404',
 [string]$Branch = 'main',
 [int]$IntervalSeconds = 15,
 [switch]$ValidateOnly,
 [switch]$RunOnce,
 [switch]$NoPauseOnError,
 [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir '0_common-logging.ps1')
Initialize-Logging -ScriptPath $PSCommandPath

$LocalStorageDir = Split-Path -Parent $ScriptDir
$Repo = Split-Path -Parent $LocalStorageDir
$CampaignFile = Join-Path $LocalStorageDir $CampaignFileName
$CampaignGitPath = ('.localstorage/{0}' -f $CampaignFileName)
$EceGitPath = '.localstorage/ECE'
$LockPath = Join-Path $env:TEMP 'talespire-toolset-git-sync.lock'
$BackupRoot = Join-Path $env:TEMP 'TaleSpireToolsetBackups'

function Invoke-Git {
 param([Parameter(ValueFromRemainingArguments = $true)] [string[]]$Arguments)
 # Windows PowerShell 5 convierte cualquier texto de stderr de un comando
 # nativo en NativeCommandError cuando ErrorActionPreference es Stop. Git usa
 # stderr también para progreso y warnings exitosos, por lo que evaluamos el
 # código de salida real y conservamos el texto sólo para diagnósticos.
 $previousErrorActionPreference = $ErrorActionPreference
 try {
  $ErrorActionPreference = 'Continue'
  $output = & git -C $Repo @Arguments 2>&1
  $exitCode = $LASTEXITCODE
 } finally {
  $ErrorActionPreference = $previousErrorActionPreference
 }
 if ($exitCode -ne 0) { throw ('git {0} falló: {1}' -f ($Arguments -join ' '), ($output -join [Environment]::NewLine)) }
 return @($output)
}

function Test-AllowedGitPath([string]$Path) {
 $normalized = $Path.Replace('\', '/')
 if ($normalized.StartsWith('./')) { $normalized = $normalized.Substring(2) }
 return $normalized -eq $CampaignGitPath -or $normalized.StartsWith($EceGitPath + '/')
}

function Assert-CampaignBlob {
 if (-not (Test-Path -LiteralPath $CampaignFile)) { throw "No existe el archivo de campaña configurado: $CampaignFile" }
 try {
  $raw = Get-Content -LiteralPath $CampaignFile -Raw -Encoding UTF8
  $safeJson = $raw -replace '""\s*:', '"toolsetEmptyKey":'
  $root = $safeJson | ConvertFrom-Json
 }
 catch { throw 'El archivo de campaña no contiene JSON válido. Se pospone la sincronización.' }
 $envelope = $root.__talespire5eToolsetV2
 if ($null -eq $envelope) { throw 'No se encontró el envelope __talespire5eToolsetV2.' }
 if ($envelope.format -ne 'talespire-toolset-campaign-v2') { throw 'El envelope no corresponde al formato V2 esperado.' }
 if ([string]$envelope.checksum -notmatch '^[0-9a-fA-F]{64}$') { throw 'El checksum V2 no es válido.' }
 if ($null -eq $envelope.campaign -or $envelope.campaign.schemaVersion -ne 2) { throw 'La campaña embebida no cumple schemaVersion 2.' }
}

function Backup-CampaignBlob {
 New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
 $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
 Copy-Item -LiteralPath $CampaignFile -Destination (Join-Path $BackupRoot "$CampaignFileName-$stamp.json")
 $backups = Get-ChildItem -LiteralPath $BackupRoot -Filter "$CampaignFileName-*.json" | Sort-Object LastWriteTime -Descending
 $backups | Select-Object -Skip 20 | Remove-Item -Force
}

function Get-ScopedStatus {
 return @(Invoke-Git status --porcelain -- $CampaignGitPath $EceGitPath)
}

function Commit-ScopedChanges {
 $changes = Get-ScopedStatus
 if (-not $changes.Count) { return $false }
 Assert-CampaignBlob
 Invoke-Git add -- $CampaignGitPath $EceGitPath | Out-Null
 $staged = @(Invoke-Git diff --cached --name-only -- $CampaignGitPath $EceGitPath)
 if (-not $staged.Count) { return $false }
 Invoke-Git commit -m ('sync(campaign): estado V2 y ECE {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -- $CampaignGitPath $EceGitPath | Out-Null
 Write-Log ('Commit acotado: {0}' -f ($staged -join ', '))
 return $true
}

function Get-RemoteDataChanges {
 Invoke-Git fetch origin $Branch | Out-Null
 $mergeBase = (Invoke-Git merge-base HEAD "origin/$Branch" | Select-Object -First 1)
 $remoteChanges = @(Invoke-Git diff --name-only $mergeBase "origin/$Branch")
 $unsafe = @($remoteChanges | Where-Object { -not (Test-AllowedGitPath $_) })
 if ($unsafe.Count) { throw ('El remoto contiene cambios de código o configuración. Actualizá manualmente antes de jugar: {0}' -f ($unsafe -join ', ')) }
 return $remoteChanges
}

function Sync-Once {
 Assert-CampaignBlob
 Backup-CampaignBlob
 Commit-ScopedChanges | Out-Null
 $remoteChanges = Get-RemoteDataChanges
 if ($remoteChanges.Count) {
  $unrelatedDirty = @(Invoke-Git status --porcelain | Where-Object {
    $path = if ($_.Length -gt 3) { $_.Substring(3) } else { '' }
    -not (Test-AllowedGitPath $path)
  })
  if ($unrelatedDirty.Count) { throw 'Hay cambios locales fuera de campaña/ECE. No se hará rebase automático ni se tocará el código.' }
  try { Invoke-Git rebase "origin/$Branch" | Out-Null }
  catch {
   & git -C $Repo rebase --abort 2>$null
   throw 'Git detectó un conflicto de datos. Se abortó el rebase y se preservó el estado local.'
  }
  Assert-CampaignBlob
 }
 Invoke-Git push origin "HEAD:$Branch" | Out-Null
 if (-not $Quiet) { Write-Log 'Estado de campaña y ECE sincronizados.' }
}

$lock = $null
try {
 $lock = [System.IO.File]::Open($LockPath, 'OpenOrCreate', 'ReadWrite', 'None')
 if (-not (Test-Path (Join-Path $Repo '.git'))) { throw "La carpeta activa no es un repositorio Git: $Repo" }
 if ($ValidateOnly) {
  Assert-CampaignBlob
  $changes = Get-ScopedStatus
  Write-Log ("Validación correcta. Rutas sincronizables con cambios: {0}" -f $changes.Count)
  exit 0
 }
 do {
  $finalAttempt = $RunOnce -or (Test-Path -LiteralPath $StopSignalFile)
  try { Sync-Once }
  catch {
   Write-Log ("Sync pospuesto: {0}" -f $_.Exception.Message) -Color 'Yellow'
   if ($finalAttempt) { throw }
  }
  if ($finalAttempt) { break }
  Start-Sleep -Seconds ([Math]::Max(5, $IntervalSeconds))
 } while ($true)
 exit 0
}
catch {
 $message = "ERROR fatal de sync: $($_.Exception.Message)"
 Write-Log $message -Color 'Red'
 if (-not $NoPauseOnError) { Show-ErrorAlert $message }
 exit 1
}
finally {
 if ($lock) { $lock.Dispose() }
}
