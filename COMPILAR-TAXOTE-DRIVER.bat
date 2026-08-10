@echo off
setlocal
title TAXOTE Driver - Compilar APK
set "JAVA_HOME=D:\Taxote\.android-toolchain\jdk\jdk-17.0.20+8"
set "ANDROID_SDK_ROOT=D:\Taxote\.android-sdk"
set "ANDROID_HOME=D:\Taxote\.android-sdk"
set "ANDROID_USER_HOME=D:\Taxote\.android-user"
set "GRADLE_USER_HOME=D:\Taxote\.gradle"
set "GRADLE=D:\Taxote\.android-toolchain\gradle\gradle-8.9\bin\gradle.bat"

if not exist "%GRADLE%" (
  echo No se encontraron las herramientas Android de TAXOTE.
  pause
  exit /b 1
)

cd /d "D:\Taxote\android-driver"
call "%GRADLE%" --no-daemon :app:assembleRelease
if errorlevel 1 (
  echo.
  echo No se pudo compilar TAXOTE Driver.
  pause
  exit /b 1
)

if not exist "D:\Taxote\downloads" mkdir "D:\Taxote\downloads"
copy /y "D:\Taxote\android-driver\app\build\outputs\apk\release\app-release.apk" "D:\Taxote\downloads\TAXOTE-Driver.apk" >nul
echo.
echo APK creado correctamente:
echo D:\Taxote\downloads\TAXOTE-Driver.apk
pause
