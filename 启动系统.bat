@echo off
chcp 65001 >nul
REM ============================================================
REM 秋招通 QiuzhaoHub 一键启动（本地双击运行，无需 WorkBuddy）
REM 顺序：PostgreSQL -> 后端(8080) -> 前端(5173)
REM 说明：若上次是非正常关机，PostgreSQL 首启会做崩溃恢复(慢盘约 1~2 分钟)，
REM       属一次性；用本目录「停止系统.bat」正常关机后，下次秒级启动。
REM ============================================================
setlocal
set "JAVA_HOME=D:\Soft\Java\jdk-21.0.11-hotspot"
set "PG_HOME=D:\Soft\PostgreSQL"
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "JAR=%BACKEND%\target\qiuzhaohub-backend-1.0.0.jar"

echo [1/3] 检查并启动 PostgreSQL (5432) ...
netstat -ano | findstr ":5432" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo   PostgreSQL 未运行，启动中（含崩溃恢复时可能需 1~2 分钟，请耐心等待窗口出现 "ready"）...
    "%PG_HOME%\bin\pg_ctl.exe" -D "%PG_HOME%\data" -l "%PG_HOME%\pg_start.log" -t 600 start
    if errorlevel 1 (
        echo   [警告] PostgreSQL 启动失败，请查看 %PG_HOME%\pg_start.log
    ) else (
        echo   PostgreSQL 已启动。
    )
) else (
    echo   PostgreSQL 已在运行，跳过。
)

echo [2/3] 启动后端 (http://127.0.0.1:8080/api) ...
if not exist "%JAR%" (
    echo   [错误] 未找到 %JAR%，请先在 backend 目录执行 mvn package -DskipTests
    pause
    exit /b 1
)
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul
if errorlevel 1 (
    start "秋招通-后端" cmd /k "set JAVA_HOME=%JAVA_HOME% && %JAVA_HOME%\bin\java.exe -jar %JAR% --server.port=8080"
    echo   后端窗口已打开，启动中...
) else (
    echo   后端 8080 已被占用，跳过。
)

echo [3/3] 启动前端 (http://localhost:5173) ...
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if errorlevel 1 (
    start "秋招通-前端" cmd /k "cd /d %FRONTEND% && npm run dev"
    echo   前端窗口已打开，启动中...
) else (
    echo   前端 5173 已被占用，跳过。
)

echo.
echo ============================================================
echo  启动完成！
echo  前端页面 : http://localhost:5173/
echo  后端接口 : http://127.0.0.1:8080/api
echo  关闭这些窗口不会停止服务；停止请运行「停止系统.bat」
echo ============================================================
echo.
pause
endlocal
