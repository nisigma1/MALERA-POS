$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'FOX Kafeteri' -ErrorAction SilentlyContinue) {
    throw 'Mbylle MALERA POS para konfigurimit.'
}
$duoProfile = Join-Path $env:APPDATA 'FOX Kafeteri'
if (!(Test-Path -LiteralPath (Join-Path $duoProfile 'fox.sqlite') -PathType Leaf)) {
    throw 'Databaza e MALERA POS nuk u gjet.'
}
$destination = Join-Path $duoProfile 'duo-operators-v1.json'
$enrollment = Join-Path $duoProfile 'duo-operator-enrollment-v1'
if (Test-Path -LiteralPath $destination) { throw 'PIN-et jane tashme te konfiguruara.' }

Add-Type -AssemblyName System.Security
$labels = [ordered]@{
    OWNER = 'PRONARI DUO'
    AM = 'PUNONJESI PARADITE'
    PM = 'PUNONJESI MASDITE'
}
$users = [ordered]@{}
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$ownerCheck = $null
try {
    foreach ($id in $labels.Keys) {
        $secure = Read-Host "PIN per $($labels[$id])" -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $pinBytes = $null
        try {
            $pin = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
            if ($pin -cnotmatch '^[0-9]{4}$') { throw 'PIN-i duhet te kete kater shifra.' }
            $pinBytes = [Text.Encoding]::ASCII.GetBytes($pin)
            $pin = $null
            if ($id -eq 'OWNER') { $ownerCheck = $pinBytes.Clone() }
            elseif (([BitConverter]::ToUInt32($pinBytes, 0) -eq [BitConverter]::ToUInt32($ownerCheck, 0))) {
                throw 'PIN-i i pronarit duhet te jete i ndryshem nga ai i punonjesve.'
            }
            $salt = New-Object byte[] 16
            $random.GetBytes($salt)
            $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new(
                $pinBytes, $salt, 600000, [Security.Cryptography.HashAlgorithmName]::SHA256)
            try {
                $users[$id] = @{
                    salt = [BitConverter]::ToString($salt).Replace('-', '').ToLowerInvariant()
                    hash = [BitConverter]::ToString($kdf.GetBytes(32)).Replace('-', '').ToLowerInvariant()
                }
            } finally { $kdf.Dispose() }
        } finally {
            if ($pinBytes) { [Array]::Clear($pinBytes, 0, $pinBytes.Length) }
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
            $secure.Dispose()
        }
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{version=1; users=$users} -Compress))
    try {
        $cipher = [Security.Cryptography.ProtectedData]::Protect(
            $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    $encoded = [Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($cipher))
    $stage = $destination + '.' + [Guid]::NewGuid().ToString('N') + '.next'
    try {
        $file = [IO.File]::Open($stage, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $file.Write($encoded, 0, $encoded.Length); $file.Flush($true) }
        finally { $file.Dispose() }
        if (!(Test-Path -LiteralPath $enrollment)) {
            $marker = [IO.File]::Open($enrollment, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $marker.Flush($true) }
            finally { $marker.Dispose() }
        }
        [IO.File]::Move($stage, $destination)
    } finally {
        if ([IO.File]::Exists($stage)) { [IO.File]::Delete($stage) }
    }
    Write-Host 'PIN-et u konfiguruan per kete llogari te Windows-it.'
} finally {
    if ($ownerCheck) { [Array]::Clear($ownerCheck, 0, $ownerCheck.Length) }
    $random.Dispose()
    $users.Clear()
}
