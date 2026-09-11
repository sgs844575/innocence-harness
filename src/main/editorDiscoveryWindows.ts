/** Installed application metadata supplies display names; no product catalogue is embedded. */
export const windowsEditorInventory = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$candidates = @{}
function Add-Candidate([string]$target, [bool]$associated = $false) {
  $target = [Environment]::ExpandEnvironmentVariables($target).Trim()
  if ($target -match '^"([^"]+\.exe)"') { $target = $Matches[1] }
  elseif ($target -match '^(.+?\.exe)(?:\s|,|$)') { $target = $Matches[1] }
  else { return }
  if (-not [IO.File]::Exists($target)) { return }
  $key = $target.ToLowerInvariant()
  if ($candidates.ContainsKey($key)) { $candidates[$key].associated = $candidates[$key].associated -or $associated }
  else { $candidates[$key] = @{ path = $target; associated = $associated } }
}
$classes = Get-Item 'Registry::HKEY_CLASSES_ROOT'
$applications = $classes.OpenSubKey('Applications')
try {
  foreach ($application in $applications.GetSubKeyNames()) {
    $command = $applications.OpenSubKey($application + '\shell\open\command')
    if ($command) { Add-Candidate $command.GetValue(''); $command.Dispose() }
  }
  foreach ($extension in @('.ts', '.tsx', '.js', '.py', '.rs', '.go', '.cpp', '.md')) {
    $key = $classes.OpenSubKey($extension)
    $types = @()
    if ($key) { $types += $key.GetValue(''); $key.Dispose() }
    $openWith = $classes.OpenSubKey($extension + '\OpenWithProgids')
    if ($openWith) { $types += $openWith.GetValueNames(); $openWith.Dispose() }
    foreach ($type in $types) {
      if (-not $type) { continue }
      $command = $classes.OpenSubKey($type + '\shell\open\command')
      if ($command) { Add-Candidate $command.GetValue('') ($extension -in @('.md', '.tsx', '.rs', '.go', '.cpp')); $command.Dispose() }
    }
  }
} finally { if ($applications) { $applications.Dispose() }; $classes.Dispose() }
$shortcutShell = New-Object -ComObject WScript.Shell
try {
  foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
    Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -Recurse -File | ForEach-Object {
      $shortcut = $shortcutShell.CreateShortcut($_.FullName)
      Add-Candidate $shortcut.TargetPath
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut)
    }
  }
} finally { if ($shortcutShell) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcutShell) } }
# Inspect application manifests without recursively walking installation contents.
function Add-Installation([string]$directory) {
  if (-not $directory) { return }
  if (Test-Path -LiteralPath (Join-Path $directory 'resources\app\product.json') -PathType Leaf) {
    Get-ChildItem -LiteralPath $directory -Filter '*.exe' -File | ForEach-Object { Add-Candidate $_.FullName }
  }
  $infoPath = Join-Path $directory 'product-info.json'
  if (Test-Path -LiteralPath $infoPath -PathType Leaf) {
    $info = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($launcher in $info.launch) { if ($launcher.launcherPath) { Add-Candidate (Join-Path $directory $launcher.launcherPath) } }
  }
}
$roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'))
foreach ($root in $roots) {
  if (-not $root) { continue }
  Get-ChildItem -LiteralPath $root -Directory | ForEach-Object {
    Add-Installation $_.FullName
    Get-ChildItem -LiteralPath $_.FullName -Directory | ForEach-Object { Add-Installation $_.FullName }
  }
}
foreach ($folder in ($env:PATH -split ';')) {
  if ($folder -and (Test-Path -LiteralPath $folder -PathType Container)) {
    Add-Installation $folder
    Add-Installation (Split-Path $folder)
  }
}
$results = @(foreach ($entry in $candidates.Values) {
  $file = Get-Item -LiteralPath $entry.path
  if ($file.BaseName -match '(?i)(unins|setup|crash|update|helper|elevat|report|service|installer|restart)') { continue }
  $directory = $file.DirectoryName
  $product = $null
  $ide = $null
  $productPath = Join-Path $directory 'resources\app\product.json'
  if ([IO.File]::Exists($productPath)) { $product = [IO.File]::ReadAllText($productPath) | ConvertFrom-Json }
  foreach ($infoPath in @((Join-Path $directory 'product-info.json'), (Join-Path (Split-Path $directory) 'product-info.json'))) {
    if ([IO.File]::Exists($infoPath)) { $ide = [IO.File]::ReadAllText($infoPath) | ConvertFrom-Json; break }
  }
  $description = $file.VersionInfo.FileDescription
  $name = $description
  $sourceEditor = $description -match '(?i)(text editor|code editor|source.*editor|integrated development|\bIDE\b)' -or $name -match '(?i)(text editor|code editor)' -or (Split-Path $directory -Leaf) -eq 'IDE'
  $productEditor = $product -and $product.nameLong -and $product.applicationName
  $ideEditor = $ide -and $ide.name -and @($ide.launch | Where-Object { [IO.Path]::GetFileName($_.launcherPath) -eq $file.Name }).Count -gt 0
  if ($ide -and -not $ideEditor) { continue }
  $associatedEditor = $entry.associated -and $description -notmatch '(?i)(browser|player|script host|interpreter)'
  if (-not ($productEditor -or $ideEditor -or $sourceEditor -or $associatedEditor)) { continue }
  if ($productEditor) { $name = $product.nameLong }
  elseif ($ideEditor) { $name = $ide.name }
  if (-not $name) { $name = $description }
  if (-not $name) { $name = $file.BaseName }
  @{ executable = $file.FullName; name = $name }
})
ConvertTo-Json -InputObject $results -Compress
`;
