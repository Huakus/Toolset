<#
.SYNOPSIS
Exporta una hoja Markdown por cada personaje de la campaña V2.

.DESCRIPTION
Modo nuevo recomendado:
- Ejecutar desde 2_orquestrator.ps1 con -RunOnce -Quiet.
- El script no maneja el tick cuando se usa -RunOnce.

Compatibilidad:
- Si se ejecuta sin -RunOnce, mantiene el modo worker anterior con IntervalSeconds y StopSignalFile.
#>

param(
    [string]$StopSignalFile,
    [string]$CampaignFileName = 'd8383957-1a6b-4719-9b68-797f03145404',
    [string]$OutputDirectory,
    [int]$IntervalSeconds = 10,
    [switch]$RunOnce,
    [switch]$Quiet,
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

$LocalStorageDir = Split-Path -Parent $ScriptDir
$CampaignFile = Join-Path $LocalStorageDir $CampaignFileName
$OutputDir = if ($OutputDirectory) { [System.IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $LocalStorageDir 'ECE\Hojas' }

$IgnoredDirectoryNames = @(
    'Hojas',
    'Lore',
    '.runtime',
    '.tmp.driveupload',
    '.vscode',
    '.git',
    'node_modules',
    'scripts'
)

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

function Test-ShouldStop {
    return ($StopSignalFile -and (Test-Path -LiteralPath $StopSignalFile))
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)] [string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        [void](New-Item -ItemType Directory -Force -Path $Path)
    }
}

function Remove-Accents {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }

    $normalized = $Text.Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object System.Text.StringBuilder

    foreach ($char in $normalized.ToCharArray()) {
        $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($char)
        if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($char)
        }
    }

    return $builder.ToString().Normalize([Text.NormalizationForm]::FormC)
}

function ConvertTo-SafeFilePart {
    param([string]$Name)

    $value = Remove-Accents $Name
    $value = $value.ToLowerInvariant()
    $value = $value -replace '[^a-z0-9]+', '_'
    $value = $value -replace '_+', '_'
    $value = $value.Trim('_')

    if ([string]::IsNullOrWhiteSpace($value)) { return 'sin_nombre' }

    return $value
}

function Repair-Mojibake {
    param([string]$Text)
    if ($null -eq $Text) { return $null }
    $value = $Text
    for ($attempt = 0; $attempt -lt 2 -and ($value.IndexOf([char]0x00C3) -ge 0 -or $value.IndexOf([char]0x00C2) -ge 0); $attempt++) {
        $bytes = [Text.Encoding]::GetEncoding(1252).GetBytes($value)
        $value = [Text.Encoding]::UTF8.GetString($bytes)
    }
    return $value
}

function Get-TextFileCandidates {
    param([Parameter(Mandatory = $true)] [string]$RootPath)

    $allFiles = Get-ChildItem -LiteralPath $RootPath -File -Recurse -ErrorAction SilentlyContinue

    foreach ($file in $allFiles) {
        $relativeDirectory = $file.DirectoryName.Substring($RootPath.Length)
        $directoryNames = $relativeDirectory.Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries)

        $isIgnored = $false
        foreach ($dirName in $directoryNames) {
            if ($IgnoredDirectoryNames -contains $dirName) {
                $isIgnored = $true
                break
            }
        }

        if ($isIgnored) { continue }

        if ($file.Extension -eq '.json' -or [string]::IsNullOrWhiteSpace($file.Extension)) {
            $file
        }
    }
}

function ConvertFrom-ToolsetJson {
    param([Parameter(Mandatory = $true)] [string]$JsonText)

    # Windows PowerShell falla con propiedades cuyo nombre es vacio: "":
    $safeJson = $JsonText -replace '""\s*:', '"toolsetEmptyKey":'
    return $safeJson | ConvertFrom-Json
}

function Get-PropertyValue {
    param(
        [Parameter(Mandatory = $true)] $Object,
        [Parameter(Mandatory = $true)] [string[]]$Names
    )

    if ($null -eq $Object) { return $null }

    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties | Where-Object { $_.Name -eq $name } | Select-Object -First 1
        if ($property) { return $property.Value }
    }

    return $null
}

function Find-ToolsetJsonWithCharacters {
    if (-not (Test-Path -LiteralPath $CampaignFile)) { return $null }
    $candidates = @(Get-Item -LiteralPath $CampaignFile)

    foreach ($file in $candidates) {
        try {
            $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop

            if ($text -notmatch '"__talespire5eToolsetV2"') { continue }

            $json = ConvertFrom-ToolsetJson -JsonText $text
            $envelope = Get-PropertyValue -Object $json -Names @('__talespire5eToolsetV2')
            if (-not $envelope -or $envelope.format -ne 'talespire-toolset-campaign-v2') { continue }
            if ([string]$envelope.checksum -notmatch '^[0-9a-fA-F]{64}$') { continue }
            if ($envelope.campaign.schemaVersion -ne 2) { continue }
            $characters = Get-PropertyValue -Object $envelope.campaign -Names @('characters')

            if ($characters) {
                return [PSCustomObject]@{
                    File = $file
                    Json = $json
                    Characters = $characters
                    Checksum = [string]$envelope.checksum
                }
            }
        } catch {
            continue
        }
    }

    return $null
}

function Convert-CharacterContainerToList {
    param([Parameter(Mandatory = $true)] $Characters)

    $result = New-Object System.Collections.Generic.List[object]

    if ($Characters -is [System.Array]) {
        foreach ($character in $Characters) {
            $name = Get-PropertyValue -Object $character -Names @('name', 'nombre', 'characterName')
            if ([string]::IsNullOrWhiteSpace($name)) { $name = 'sin_nombre' }

            $result.Add([PSCustomObject]@{
                Name = Repair-Mojibake ([string]$name)
                Value = $character
            })
        }

        return $result
    }

    foreach ($property in $Characters.PSObject.Properties) {
        $character = $property.Value
        $name = Get-PropertyValue -Object $character -Names @('name', 'nombre', 'characterName')
        if ([string]::IsNullOrWhiteSpace($name)) { $name = $property.Name }

        $result.Add([PSCustomObject]@{
            Name = Repair-Mojibake ([string]$name)
            Value = $character
        })
    }

    return $result
}

function ConvertTo-PublicProjection {
    param($Value)

    if ($null -eq $Value) { return $null }
    if ($Value -is [string]) { return Repair-Mojibake $Value }
    if ($Value -is [ValueType]) { return $Value }
    if ($Value -is [System.Collections.IDictionary]) {
        $result = [ordered]@{}
        foreach ($key in $Value.Keys) {
            if ([string]$key -in @('legacy', 'legacyData', 'collections', 'unmapped')) { continue }
            $result[[string]$key] = ConvertTo-PublicProjection $Value[$key]
        }
        return $result
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value | ForEach-Object { ConvertTo-PublicProjection $_ })
    }

    $result = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
        if ($property.Name -in @('legacy', 'legacyData', 'collections', 'unmapped')) { continue }
        $result[$property.Name] = ConvertTo-PublicProjection $property.Value
    }
    return $result
}

function Convert-CharacterToText {
    param(
        [Parameter(Mandatory = $true)] [string]$Name,
        [Parameter(Mandatory = $true)] $Character
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("# $Name")
    $lines.Add('')
    $lines.Add('> Archivo generado automaticamente desde la campana V2 del Toolset.')
    $lines.Add('> No editar manualmente.')
    $lines.Add('')

    $identity = Get-PropertyValue -Object $Character -Names @('identity')
    $class = Get-PropertyValue -Object $identity -Names @('className')
    $race = Get-PropertyValue -Object $Character.legacy.unmapped -Names @('race', 'raza')
    $level = Get-PropertyValue -Object $identity -Names @('level')

    if ($race -or $class -or $level) {
        $lines.Add('## Resumen')
        if ($race) { $lines.Add(("- Raza: {0}" -f (Repair-Mojibake ([string]$race)))) }
        if ($class) { $lines.Add(("- Clase: {0}" -f (Repair-Mojibake ([string]$class)))) }
        if ($level) { $lines.Add("- Nivel: $level") }
        $lines.Add('')
    }

    $lines.Add('## Estado actual')
    $lines.Add('')
    $lines.Add(('- Revision: {0}' -f $Character.revision))
    $lines.Add(('- Ultima actualizacion: {0}' -f $Character.metadata.updatedAt))
    $lines.Add('')
    $lines.Add('## Datos completos V2')
    $lines.Add('')
    $lines.Add('```json')
    $publicCharacter = ConvertTo-PublicProjection $Character
    $lines.Add(($publicCharacter | ConvertTo-Json -Depth 100))
    $lines.Add('```')
    $lines.Add('')

    return ($lines -join [Environment]::NewLine)
}

function Write-TextIfChanged {
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [Parameter(Mandatory = $true)] [string]$Content
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    if (Test-Path -LiteralPath $Path) {
        $previous = [System.IO.File]::ReadAllText($Path)
        if ($previous -eq $Content) { return $false }
    }

    $temporaryPath = "$Path.tmp-$PID"
    [System.IO.File]::WriteAllText($temporaryPath, $Content, $utf8NoBom)
    if (Test-Path -LiteralPath $Path) {
        $backupPath = "$Path.bak-$PID"
        [System.IO.File]::Replace($temporaryPath, $Path, $backupPath)
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    } else {
        Move-Item -LiteralPath $temporaryPath -Destination $Path
    }
    return $true
}

function Invoke-ExportCharacterSheetsOnce {
    Ensure-Directory $OutputDir

    $source = Find-ToolsetJsonWithCharacters
    if (-not $source) {
        Write-Log 'WARNING: No se encontró una campaña con envelope V2 válido.' -Color 'Yellow'
        return
    }

    $characters = Convert-CharacterContainerToList -Characters $source.Characters
    $expectedFiles = New-Object System.Collections.Generic.HashSet[string]
    $changedCount = 0
    $removedCount = 0
    $summaryLines = New-Object System.Collections.Generic.List[string]
    $summaryLines.Add('# Resumen de personajes')
    $summaryLines.Add('')
    $summaryLines.Add(('> Estado V2 `{0}`. Generado automaticamente; no editar.' -f $source.Checksum))
    $summaryLines.Add('')

    foreach ($entry in $characters) {
        $safeName = ConvertTo-SafeFilePart $entry.Name
        $fileName = "$safeName.md"
        $path = Join-Path $OutputDir $fileName
        [void]$expectedFiles.Add($path.ToLowerInvariant())

        $content = Convert-CharacterToText -Name $entry.Name -Character $entry.Value

        if (Write-TextIfChanged -Path $path -Content $content) {
            $changedCount++
            Write-Log ("EXPORTADO hoja: {0}" -f $fileName)
        }

        $identity = $entry.Value.identity
        $hp = $entry.Value.combat.hitPoints
        $conditions = @($entry.Value.combat.conditions | ForEach-Object { $_.label })
        $summaryLines.Add(('## {0}' -f $entry.Name))
        $summaryLines.Add(('- Clase y nivel: {0} {1}' -f (Repair-Mojibake ([string]$identity.className)), $identity.level))
        $summaryLines.Add(('- PG: {0} + {1} temporales / {2}; CA: {3}; velocidad: {4}' -f $hp.current, $hp.temporary, $hp.maximum, $entry.Value.combat.armorClass, $entry.Value.combat.speed))
        $summaryLines.Add(('- Condiciones: {0}' -f $(if ($conditions.Count) { (@($conditions | ForEach-Object { Repair-Mojibake ([string]$_) }) -join ', ') } else { 'ninguna' })))
        $summaryLines.Add(('- Hoja completa: `{0}`' -f $fileName))
        $summaryLines.Add('')
    }

    $summaryPath = Join-Path $OutputDir 'Resumen_Personajes.md'
    [void]$expectedFiles.Add($summaryPath.ToLowerInvariant())
    if (Write-TextIfChanged -Path $summaryPath -Content ($summaryLines -join [Environment]::NewLine)) {
        $changedCount++
        Write-Log 'EXPORTADO resumen: Resumen_Personajes.md'
    }

    $existingFiles = Get-ChildItem -LiteralPath $OutputDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @('.txt', '.md') }
    foreach ($file in $existingFiles) {
        if (-not $expectedFiles.Contains($file.FullName.ToLowerInvariant())) {
            Remove-Item -LiteralPath $file.FullName -Force
            $removedCount++
            Write-Log ("ELIMINADA hoja obsoleta: {0}" -f $file.Name)
        }
    }

    if (-not $Quiet -and $changedCount -eq 0 -and $removedCount -eq 0) {
        Write-Log 'Hojas de personaje actualizadas. No hay cambios.'
    }
}

# ============================================================
# Flujo principal
# ============================================================

try {
    if (-not $Quiet) {
        Write-Log 'Iniciando exportador de hojas de personajes...'
        Write-Log ("Carpeta destino: {0}" -f $OutputDir)
    }

    if ($RunOnce) {
        Invoke-ExportCharacterSheetsOnce
        return
    }

    while (-not (Test-ShouldStop)) {
        Invoke-ExportCharacterSheetsOnce
        Start-Sleep -Seconds $IntervalSeconds
    }
} catch {
    Write-Log ("ERROR: {0}" -f $_.Exception.Message) -Color 'Red'
    Wait-BeforeExitOnError
    throw
}
