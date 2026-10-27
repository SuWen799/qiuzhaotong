@echo off
chcp 65001 >nul
REM 秋招通 QiuzhaoHub 后端启动脚本
REM 需要：Java 21 (D:\Soft\Java\jdk-21.0.11-hotspot) 已安装，PostgreSQL 已启动

set JAVA_HOME=D:\Soft\Java\jdk-21.0.11-hotspot
set BACKEND_DIR=%~dp0backend
set JAR=%BACKEND_DIR%\target\qiuzhaohub-backend-1.0.0.jar

if not exist "%JAR%" (
    echo [错误] 未找到 %JAR%
    echo 请先执行: mvn package -DskipTests
    pause
    exit /b 1
)

echo 正在启动秋招通后端 (http://127.0.0.1:8080/api) ...
"%JAVA_HOME%\bin\java" -jar "%JAR%" --server.port=8080
pause
