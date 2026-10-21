@echo off
echo ===== SNAPSHOT FOLDERS =====
dir /b /ad snapshots
echo.
echo ===== info of first snapshot =====
type snapshots\0001\00_info.txt
echo.
echo ===== comparison report =====
type informes\informe_0001_vs_0002.txt
echo.
echo ===== CHECKS =====
for %%D in (0001 0002) do if not exist "snapshots\%%D\00_info.txt" goto :fail
if not exist "informes\informe_0001_vs_0002.txt" goto :fail
echo ALL CHECKS PASSED
exit /b 0
:fail
echo CHECK FAILED
exit /b 1
