param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference='Stop'
$qaFile=Get-Item -LiteralPath $File
if ($qaFile.Name -ne 'fox.sqlite-shm' -or $qaFile.Directory.Name -notlike 'fox-qa-*' -or -not (Test-Path -LiteralPath (Join-Path $qaFile.Directory.FullName '.fox-qa.json'))) { throw 'Owned QA SHM required' }
$stream=[System.IO.FileStream]::new($qaFile.FullName,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
$mapping=$null;$view=$null
try {
 $mapping=[System.IO.MemoryMappedFiles.MemoryMappedFile]::CreateFromFile($stream,"fox-qa-shm-$pid",0,[System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::ReadWrite,[System.IO.HandleInheritability]::None,$true)
 $view=$mapping.CreateViewAccessor()
 [Console]::WriteLine('{"ready":true}')
 [Console]::ReadLine() | Out-Null
} finally {
 if($view){$view.Dispose()};if($mapping){$mapping.Dispose()};$stream.Dispose()
}
