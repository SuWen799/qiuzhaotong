@echo off
chcp 65001 >nul
REM ============================================================
REM 秋招通 QiuzhaoHub 一键停止（正常关机，避免下次启动走崩溃恢复）
REM 顺序：前端(5173) -> 后端(8080) -> PostgreSQL(干净 stop)
REM ============================================================
setlocal
set "PG_HOME=D:\Soft\PostgreSQL"

echo 停止前端 (5173) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1

echo 停止后端 (8080) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1

echo 停止 PostgreSQL（干净关机，下次秒级启动）...
"%PG_HOME%\bin\pg_ctl.exe" -D "%PG_HOME%\data" -t 120 stop
if errorlevel 1 (
    echo   [提示] PostgreSQL 未运行或已停止。
)

echo.
echo 已全部停止。需要再启动时双击「启动系统.bat」即可。
echo.
pause
endlocal
