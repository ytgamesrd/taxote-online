@echo off
setlocal
title TAXOTE Driver - Instalar por USB
set "ADB=D:\Taxote\.android-sdk\platform-tools\adb.exe"
set "APK=D:\Taxote\downloads\TAXOTE-Driver.apk"

if not exist "%ADB%" (
  echo No se encontro ADB dentro de TAXOTE.
  pause
  exit /b 1
)
if not exist "%APK%" (
  echo No se encontro el APK. Ejecuta COMPILAR-TAXOTE-DRIVER.bat primero.
  pause
  exit /b 1
)

"%ADB%" start-server
echo.
echo Verificando el celular conectado...
"%ADB%" devices -l
echo.
"%ADB%" reverse tcp:4173 tcp:4173
if errorlevel 1 (
  echo Activa Depuracion USB y acepta el permiso en el celular.
  pause
  exit /b 1
)

"%ADB%" install -r "%APK%"
if errorlevel 1 (
  echo No se pudo instalar TAXOTE Driver.
  pause
  exit /b 1
)

"%ADB%" shell am force-stop com.taxote.driver
"%ADB%" shell am start -n com.taxote.driver/.MainActivity
echo.
echo TAXOTE Driver fue instalado y abierto en el celular.
echo Mantenga este puente USB activo mientras TAXOTE use el servidor local.
pause
