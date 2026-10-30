param(
  [string]$ProjectRoot = $env:BGM_BLOG_PROJECT_ROOT,
  [string]$MigrationSeed = $env:BGM_BLOG_MOBILE_SEED
)

$ErrorActionPreference = "Stop"

$projectRoot = if ($ProjectRoot) {
  [IO.Path]::GetFullPath($ProjectRoot)
} else {
  Split-Path -Parent $PSScriptRoot
}
$signingDir = Join-Path $env:USERPROFILE ".bgmblog-signing"
$metadataPath = Join-Path $signingDir "metadata.json"
$encryptedPasswordPath = Join-Path $signingDir "password.dpapi"

if (!(Test-Path $metadataPath) -or !(Test-Path $encryptedPasswordPath)) {
  throw "Release signing files were not found in $signingDir."
}

$metadata = Get-Content -Raw $metadataPath | ConvertFrom-Json
$keystorePath = [string]$metadata.keystore
if (!(Test-Path $keystorePath)) {
  throw "Release keystore was not found: $keystorePath"
}

Add-Type -AssemblyName System.Security
$encrypted = [IO.File]::ReadAllBytes($encryptedPasswordPath)
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $encrypted,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
$password = [Text.Encoding]::UTF8.GetString($plainBytes)

$env:BGM_BLOG_KEYSTORE_FILE = $keystorePath
$env:BGM_BLOG_KEYSTORE_PASSWORD = $password
$env:BGM_BLOG_KEY_ALIAS = [string]$metadata.alias
if (!$env:JAVA_HOME) {
  $env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot"
}
$env:ANDROID_HOME = if ($env:BGM_BLOG_ANDROID_HOME) {
  $env:BGM_BLOG_ANDROID_HOME
} elseif ($env:ANDROID_HOME) {
  $env:ANDROID_HOME
} else {
  Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk"
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if ($env:BGM_BLOG_NODE_BIN) {
  $env:PATH = "$($env:BGM_BLOG_NODE_BIN);$env:PATH"
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$node) {
  throw "Node.js was not found on PATH."
}
if ($projectRoot -match "[^\x00-\x7F]") {
  Write-Warning "Android Gradle on Windows requires an ASCII project path. Move the repository to a path such as C:\Projects\bgm-local-blog before building."
}

try {
  Push-Location $projectRoot
  & $node.Source "node_modules\tailwindcss\lib\cli.js" -i ".\tailwind.input.css" -o ".\styles.css" --minify
  if ($LASTEXITCODE -ne 0) { throw "CSS build failed." }
  & $node.Source "scripts\build-web.mjs"
  if ($LASTEXITCODE -ne 0) { throw "Web build failed." }
  if ($MigrationSeed) {
    $migrationSeedPath = [IO.Path]::GetFullPath($MigrationSeed)
    if (!(Test-Path -LiteralPath $migrationSeedPath)) {
      throw "Migration seed was not found: $migrationSeedPath"
    }
    Copy-Item -LiteralPath $migrationSeedPath -Destination (Join-Path $projectRoot "dist\mobile-seed.json") -Force
  }
  & $node.Source "node_modules\@capacitor\cli\bin\capacitor" sync android
  if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed." }

  $localProperties = Join-Path $projectRoot "android\local.properties"
  $escapedSdkPath = $env:ANDROID_HOME.Replace([string][char]92, "\\")
  "sdk.dir=$escapedSdkPath" | Set-Content -LiteralPath $localProperties -Encoding Ascii

  Push-Location (Join-Path $projectRoot "android")
  & ".\gradlew.bat" assembleRelease
  if ($LASTEXITCODE -ne 0) { throw "Android release build failed." }

  $apk = Join-Path $projectRoot "android\app\build\outputs\apk\release\app-release.apk"
  if (!(Test-Path $apk)) { throw "Signed APK was not created: $apk" }
  Write-Output "SIGNED_APK=$apk"
} finally {
  if ((Get-Location).Path -like "*\android") { Pop-Location }
  if ((Get-Location).Path -eq $projectRoot) { Pop-Location }
  Remove-Item Env:BGM_BLOG_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  [Array]::Clear($plainBytes, 0, $plainBytes.Length)
  $password = $null
}
