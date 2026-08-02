<#
.SYNOPSIS
 Genera el indice de archivos publicados de ECE.

.DESCRIPTION
 Responsabilidad unica:
 - Recorrer la carpeta local publicada de ECE.
 - Generar Indice_Archivos.md con paths parciales relativos a ECE.
 - NO genera URLs completas.

 Este script NO sincroniza Git y NO publica en WordPress.

.PARAMETER Repo
 Carpeta local que se publica. Para ECE debe ser .localstorage\ECE.

.PARAMETER OutputRelativePath
 Ruta relativa del indice generado dentro de Repo.
#>
param(
 [string]$Repo,

 [string]$OutputRelativePath = 'Indice_Archivos.md',

 [switch]$NoPauseOnError,

 [switch]$Quiet,

 [switch]$RunOnce,

 [string]$StopSignalFile
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Repo) {
 $RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
 $Repo = Join-Path $RepoRoot '.localstorage\ECE'
}
$CommonLoggingScript = Join-Path $ScriptDir '0_common-logging.ps1'

if (Test-Path $CommonLoggingScript) {
 . $CommonLoggingScript
}

function Write-IndexLog([string]$Message, [string]$Color = 'White') {
 if ($Quiet) {
  return
 }

 if (Get-Command Write-Log -ErrorAction SilentlyContinue) {
  Write-Log $Message -Color $Color
 }
 else {
  Write-Host $Message
 }
}

function ConvertTo-RelativePath([string]$Root, [string]$FullName) {
 $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
 $fileFull = [System.IO.Path]::GetFullPath($FullName)
 $relative = $fileFull.Substring($rootFull.Length + 1)
 return ($relative -replace '\\', '/')
}

function Test-IsExcludedPath([string]$RelativePath) {
 $path = $RelativePath -replace '\\', '/'

 $excludedPrefixes = @(
  '.git/',
  '.github/'
 )

 foreach ($prefix in $excludedPrefixes) {
  if ($path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
   return $true
  }
 }

 $excludedFragments = @(
  '/.git/',
  '/.github/'
 )

 foreach ($fragment in $excludedFragments) {
  if ($path.IndexOf($fragment, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
   return $true
  }
 }

 return $false
}

if (-not (Test-Path $Repo)) {
 throw ('No existe la carpeta ECE a indexar: {0}' -f $Repo)
}

$Repo = [System.IO.Path]::GetFullPath($Repo)
$OutputRelativePath = $OutputRelativePath -replace '\\', '/'
$OutputFile = Join-Path $Repo ($OutputRelativePath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
$OutputDir = Split-Path -Parent $OutputFile

if (-not (Test-Path $OutputDir)) {
 [void](New-Item -ItemType Directory -Force -Path $OutputDir)
}

$files = Get-ChildItem -Path $Repo -File -Recurse -Force |
 ForEach-Object {
  $relativePath = ConvertTo-RelativePath -Root $Repo -FullName $_.FullName

  if (-not (Test-IsExcludedPath -RelativePath $relativePath)) {
   [PSCustomObject]@{
    RelativePath = $relativePath
    SizeBytes = $_.Length
   }
  }
 } |
 Sort-Object RelativePath

$indexExistsInList = $false
foreach ($file in $files) {
 if ($file.RelativePath -eq $OutputRelativePath) {
  $indexExistsInList = $true
  break
 }
}

if (-not $indexExistsInList) {
 $files = @(
  [PSCustomObject]@{
   RelativePath = $OutputRelativePath
   SizeBytes = 0
  }
 ) + $files
}

$content = New-Object System.Collections.Generic.List[string]
$content.Add('# Indice de archivos ECE')
$content.Add('')
$content.Add('Generado automaticamente por `.localstorage/scripts/8_generate-public-file-index.ps1`.')
$content.Add('')
$content.Add(('Total de archivos indexados: {0}' -f $files.Count))
$content.Add('')
$content.Add('## Uso recomendado')
$content.Add('')
$content.Add('Usar este archivo como mapa principal para encontrar paths parciales dentro de ECE.')
$content.Add('')
$content.Add('Ejemplo:')
$content.Add('')
$content.Add('Path parcial:')
$content.Add('')
$content.Add('`Lore/Indice_Historia.md`')
$content.Add('')
$content.Add('## Archivos')
$content.Add('')

foreach ($file in $files) {
 $safePath = $file.RelativePath.Replace('\', '/')
 $content.Add(('- `{0}`' -f $safePath))
}

$newContent = ($content -join "`r`n") + "`r`n"

$currentContent = $null
if (Test-Path $OutputFile) {
 $currentContent = Get-Content -Path $OutputFile -Raw -Encoding UTF8
}

if ($currentContent -ne $newContent) {
 Set-Content -Path $OutputFile -Value $newContent -Encoding UTF8
 Write-IndexLog ('REGENERADO {0}' -f $OutputFile) 'Green'
 Write-IndexLog ('Archivos indexados: {0}' -f $files.Count) 'Gray'
}
else {
 Write-IndexLog ('SIN CAMBIOS {0}' -f $OutputFile) 'Gray'
}
