@echo off
setlocal EnableDelayedExpansion
title Snapshot del Sistema - Detector de cambios
color 0B

set "BASE=%~dp0"
set "SNAPDIR=%BASE%snapshots"
set "REPORTS=%BASE%informes"
if not exist "%SNAPDIR%" mkdir "%SNAPDIR%"
if not exist "%REPORTS%" mkdir "%REPORTS%"

:menu
cls
echo ============================================================
echo            SNAPSHOT DEL SISTEMA - DETECTOR DE CAMBIOS
echo ============================================================
echo   Equipo  : %COMPUTERNAME%
echo   Usuario : %USERNAME%
set "TOTALSNAP=0"
for /f %%N in ('dir /b /ad "%SNAPDIR%" 2^>nul ^| find /c /v ""') do set "TOTALSNAP=%%N"
echo   Snapshots guardados: %TOTALSNAP%
echo ------------------------------------------------------------
echo   [1] Crear snapshot del sistema
echo   [2] Comparar dos snapshots y detectar cambios
echo   [3] Preparar envio del ultimo snapshot por Gmail
echo   [4] Abrir carpeta de snapshots
echo   [5] Salir
echo ------------------------------------------------------------
echo.
set "OP="
set /p "OP=Seleccione una opcion [1-5]: "

if "%OP%"=="1" goto snapshot
if "%OP%"=="2" goto comparar
if "%OP%"=="3" goto enviar
if "%OP%"=="4" goto abrir
if "%OP%"=="5" goto fin
echo.
echo   Opcion no valida. Intente de nuevo.
timeout /t 2 >nul
goto menu

:snapshot
cls
echo ============================================================
echo                  CREANDO SNAPSHOT DEL SISTEMA
echo ============================================================
echo.

set "LAST=0000"
for /f "delims=" %%D in ('dir /b /ad /on "%SNAPDIR%" 2^>nul') do set "LAST=%%D"
set /a SEQ=1%LAST%-10000+1
set "DT=000%SEQ%"
set "DT=%DT:~-4%"

set "DEST=%SNAPDIR%\%DT%"
mkdir "%DEST%" 2>nul

echo Snapshot: %DT%> "%DEST%\00_info.txt"
echo Fecha y hora: %DATE% %TIME%>> "%DEST%\00_info.txt"
echo Equipo: %COMPUTERNAME%>> "%DEST%\00_info.txt"
echo Usuario: %USERNAME%>> "%DEST%\00_info.txt"

echo [1/9] Informacion del sistema (puede tardar unos segundos)...
echo ### INFORMACION DEL SISTEMA ###> "%DEST%\01_sistema.txt"
systeminfo>> "%DEST%\01_sistema.txt" 2>&1

echo [2/9] Configuracion de red...
echo ### CONFIGURACION DE RED ###> "%DEST%\02_red.txt"
ipconfig /all>> "%DEST%\02_red.txt"

echo [3/9] Puertos TCP en escucha...
echo ### PUERTOS TCP EN ESCUCHA ###> "%DEST%\03_puertos_escucha.txt"
netstat -ano | findstr /C:"0.0.0.0:0 " /C:"[::]:0 ">> "%DEST%\03_puertos_escucha.txt"

echo [4/9] Procesos en ejecucion...
echo ### PROCESOS EN EJECUCION ###> "%DEST%\04_procesos.txt"
tasklist /svc>> "%DEST%\04_procesos.txt" 2>&1

echo [5/9] Usuarios locales...
echo ### USUARIOS LOCALES ###> "%DEST%\05_usuarios.txt"
net user>> "%DEST%\05_usuarios.txt" 2>&1

echo [6/9] Programas de inicio...
echo ### PROGRAMAS DE INICIO ###> "%DEST%\06_inicio.txt"
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run">> "%DEST%\06_inicio.txt" 2>&1
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run">> "%DEST%\06_inicio.txt" 2>&1
echo --- Carpeta Inicio de todos los usuarios --->> "%DEST%\06_inicio.txt"
dir /b "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp">> "%DEST%\06_inicio.txt" 2>nul
echo --- Carpeta Inicio del usuario actual --->> "%DEST%\06_inicio.txt"
dir /b "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup">> "%DEST%\06_inicio.txt" 2>nul

echo [7/9] Tareas programadas...
echo ### TAREAS PROGRAMADAS ###> "%DEST%\07_tareas.txt"
schtasks /query /fo LIST>> "%DEST%\07_tareas.txt" 2>&1

echo [8/9] Servicios...
echo ### SERVICIOS ###> "%DEST%\08_servicios.txt"
sc query type= service state= all>> "%DEST%\08_servicios.txt" 2>&1

echo [9/9] Software instalado...
echo ### SOFTWARE INSTALADO ###> "%DEST%\09_software.txt"
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" /s /v DisplayName>> "%DEST%\09_software.txt" 2>&1
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" /s /v DisplayName>> "%DEST%\09_software.txt" 2>&1
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" /s /v DisplayName>> "%DEST%\09_software.txt" 2>&1

echo.
echo ============================================================
echo  Snapshot guardado en: snapshots\%DT%
echo ============================================================
echo.
pause
goto menu

:comparar
cls
echo ============================================================
echo                   COMPARAR DOS SNAPSHOTS
echo ============================================================
echo.
set "N=0"
for /f "delims=" %%D in ('dir /b /ad /on "%SNAPDIR%" 2^>nul') do (
  set /a N+=1
  set "SNAP!N!=%%D"
  echo   [!N!] %%D
)
echo.
if %N% LSS 2 (
  echo Necesita al menos 2 snapshots para comparar. Cree otro con la opcion 1.
  pause
  goto menu
)

set "A="
set /p "A=Numero del snapshot ANTERIOR: "
set "B="
set /p "B=Numero del snapshot POSTERIOR: "
set "NA=!SNAP%A%!"
set "NB=!SNAP%B%!"

if "%NA%"=="" (
  echo Numero anterior no valido.
  pause
  goto menu
)
if "%NB%"=="" (
  echo Numero posterior no valido.
  pause
  goto menu
)
if "%NA%"=="%NB%" (
  echo Debe elegir dos snapshots distintos.
  pause
  goto menu
)
if "%NA%" GTR "%NB%" (
  set "TMP=!NA!"
  set "NA=!NB!"
  set "NB=!TMP!"
  echo Se invirtio el orden para comparar del mas antiguo al mas reciente.
)

set "INFORME=%REPORTS%\informe_%NA%_vs_%NB%.txt"
set "TMPFC=%TEMP%\snap_fc_%RANDOM%.tmp"
set "CAMBIOS=0"

echo Comparando %NA%  con  %NB% ...
echo Se comparan: puertos, usuarios, inicio de Windows y software instalado.
echo.

echo INFORME DE CAMBIOS DEL SISTEMA> "%INFORME%"
echo Snapshot anterior : %NA%>> "%INFORME%"
echo Snapshot posterior: %NB%>> "%INFORME%"
echo Generado          : %DATE% %TIME%>> "%INFORME%"
echo ============================================================>> "%INFORME%"

set "WA=%TEMP%\snap_anterior_%RANDOM%"
set "WB=%TEMP%\snap_posterior_%RANDOM%"
mkdir "%WA%" 2>nul
mkdir "%WB%" 2>nul
for %%F in (03_puertos_escucha.txt 05_usuarios.txt 06_inicio.txt 09_software.txt) do (
  copy /y "%SNAPDIR%\%NA%\%%F" "%WA%\" >nul 2>&1
  copy /y "%SNAPDIR%\%NB%\%%F" "%WB%\" >nul 2>&1
)
for %%F in (03_puertos_escucha.txt 05_usuarios.txt 06_inicio.txt 09_software.txt) do (
  fc /n "%WA%\%%F" "%WB%\%%F" > "%TMPFC%" 2>&1
  if errorlevel 2 (
    echo   [ERROR] %%F no se pudo comparar
    echo [ERROR] %%F no se pudo comparar>> "%INFORME%"
  ) else if errorlevel 1 (
    set /a CAMBIOS+=1
    echo   [CAMBIO] %%F
    echo.>> "%INFORME%"
    echo ------------------------------------------------------------>> "%INFORME%"
    echo [CAMBIO] %%F>> "%INFORME%"
    type "%TMPFC%">> "%INFORME%"
  ) else (
    echo   [OK] %%F sin cambios
  )
)
rd /s /q "%WA%" 2>nul
rd /s /q "%WB%" 2>nul
del "%TMPFC%" >nul 2>&1

echo.>> "%INFORME%"
echo RESUMEN: %CAMBIOS% de 4 categorias con cambios>> "%INFORME%"
echo.
echo ============================================================
echo  RESUMEN: %CAMBIOS% de 4 categorias con cambios
echo ============================================================
if %CAMBIOS% EQU 0 (
  echo  No se detectaron cambios entre los dos snapshots.
) else (
  echo  Revise el informe. Puertos, usuarios o programas de inicio nuevos son sospechosos.
)
echo.
echo Informe guardado en: informes\informe_%NA%_vs_%NB%.txt
start "" notepad "%INFORME%"
pause
goto menu

:enviar
cls
echo ============================================================
echo           PREPARAR ENVIO DEL ULTIMO SNAPSHOT POR GMAIL
echo ============================================================
echo.
set "ULT="
for /f "delims=" %%D in ('dir /b /ad /on "%SNAPDIR%" 2^>nul') do set "ULT=%%D"
if not defined ULT (
  echo No hay snapshots todavia. Cree uno con la opcion 1.
  pause
  goto menu
)

set "ZIP=%REPORTS%\snapshot_%ULT%.zip"
if exist "%ZIP%" del "%ZIP%"
echo Empaquetando snapshot %ULT% ...
set "TMPZ=%TEMP%\snap_zip_%RANDOM%"
mkdir "%TMPZ%\%ULT%" 2>nul
for %%F in ("%SNAPDIR%\%ULT%\*") do copy /y "%%F" "%TMPZ%\%ULT%\" >nul
tar -a -c -f "%ZIP%" -C "%TMPZ%" "%ULT%"
set "TARERR=%ERRORLEVEL%"
rd /s /q "%TMPZ%" 2>nul
if not "%TARERR%"=="0" (
  echo No se pudo crear el archivo ZIP.
  pause
  goto menu
)

echo.
echo ZIP listo: informes\snapshot_%ULT%.zip
echo.
echo Se abrira Gmail para redactar el correo y la carpeta con el ZIP.
echo Adjunte el archivo manualmente. Este programa NO guarda contrasenas
echo ni envia correos por si solo.
start "" "https://mail.google.com/mail/?view=cm&fs=1&su=Snapshot+del+sistema"
explorer /select,"%ZIP%"
pause
goto menu

:abrir
start "" "%SNAPDIR%"
goto menu

:fin
cls
echo Gracias por usar Snapshot del sistema.
timeout /t 2 >nul
endlocal
exit /b 0
