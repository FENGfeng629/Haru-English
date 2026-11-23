@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "bin\Release\net10.0-windows10.0.19041.0\HaruEnglishPet.exe" (
    start "" "bin\Release\net10.0-windows10.0.19041.0\HaruEnglishPet.exe"
) else (
    echo 正在首次编译 Haru 英语桌宠...
    dotnet build -c Release
    start "" "bin\Release\net10.0-windows10.0.19041.0\HaruEnglishPet.exe"
)
