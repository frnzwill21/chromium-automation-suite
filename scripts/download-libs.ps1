$htmlLib = Join-Path $PSScriptRoot "..\html-extractor\lib"
$yamlDir = Join-Path $PSScriptRoot "..\yaml-automator"
New-Item -ItemType Directory -Force -Path $htmlLib | Out-Null
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/dompurify@3.2.7/dist/purify.min.js" -OutFile "$htmlLib\purify.min.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js" -OutFile "$htmlLib\turndown.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mozilla/readability@0.6.0/Readability.js" -OutFile "$htmlLib\Readability.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js" -OutFile "$yamlDir\js-yaml.min.js"
Write-Host "All vendor libraries downloaded successfully!"
