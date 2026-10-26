<#
Makes a Tizen author certificate and a signing profile with Samsung's Tizen CLI, for the Samsung TVs from 2016 to
2022 that take a Tizen certificate (2023 and newer ones need a Samsung certificate instead).

    .\screenrevo\tools\new-tizen-certificate.ps1                          # profile "ScreenRevo"
    .\screenrevo\tools\new-tizen-certificate.ps1 -Name Mine -BackupTo D:\keys

The password is asked here, so it never lands in the shell's history. Keep it and the .p12: every update of an app
has to be signed with the same certificate, or the TV refuses it.
#>
param(
    [string]$Name = 'ScreenRevo',
    [string]$Country = 'BR',
    [string]$BackupTo = '',
    [string]$Studio = $(if ($env:TIZEN_STUDIO) { $env:TIZEN_STUDIO } else { 'C:\tizen-studio' })
)
$ErrorActionPreference = 'Stop'

$tizen = Join-Path $Studio 'tools\ide\bin\tizen.bat'
if (-not (Test-Path $tizen)) { throw "Samsung's Tizen CLI isn't in $Studio (pass -Studio or set TIZEN_STUDIO)." }
$data = (Get-Content (Join-Path $Studio 'sdk.info') | Where-Object { $_ -like 'TIZEN_SDK_DATA_PATH=*' }) -replace '^TIZEN_SDK_DATA_PATH=', ''
$file = $Name.ToLower()
$keystore = Join-Path $data 'keystore'
if (Test-Path $keystore) {
    $old = Get-ChildItem $keystore -Recurse -Filter "$file.p12" | Select-Object -First 1
    if ($old) { throw "$($old.FullName) already exists and may already sign your apps: use it, or pick another -Name." }
}

function Plain([Security.SecureString]$secure) {
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# Letters and digits only: the password goes through tizen.bat, where & ^ % ! and quotes break it.
$password = Plain (Read-Host 'Certificate password (8 or more letters and digits)' -AsSecureString)
if ($password -notmatch '^[A-Za-z0-9]{8,}$') { throw 'Use 8 or more letters and digits, nothing else.' }
if ((Plain (Read-Host 'The same password again' -AsSecureString)) -ne $password) { throw "The passwords don't match." }

& $tizen certificate -a $Name -p $password -c $Country -n $Name -f $file
if ($LASTEXITCODE -ne 0) { throw "tizen certificate failed (above)." }
$p12 = Get-ChildItem $keystore -Recurse -Filter "$file.p12" | Select-Object -First 1
if (-not $p12) { throw "No $file.p12 under $keystore after tizen certificate (see its output above)." }

# No -d: the profile takes Tizen's own public distributor certificate, which these TVs accept.
& $tizen security-profiles add -n $Name -a $p12.FullName -p $password -A
if ($LASTEXITCODE -ne 0) { throw "tizen security-profiles add failed (above)." }
& $tizen security-profiles list

if ($BackupTo) {
    New-Item -ItemType Directory -Force -Path $BackupTo | Out-Null
    Copy-Item $p12.FullName -Destination $BackupTo
    Write-Host "Backup copy: $(Join-Path (Resolve-Path $BackupTo) $p12.Name)"
}
Write-Host "Done. Sign with --sign $Name. Keep the password: updates need the same certificate."
