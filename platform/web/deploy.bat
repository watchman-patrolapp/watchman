@echo off
REM Neighborhood Watch Platform - Vercel Deployment Script (Windows)
REM Usage: deploy.bat [environment]
REM Environment: dev, preview, prod (default: prod)

setlocal enabledelayedexpansion

REM Configuration
set "PROJECT_DIR=%~dp0"
set "ENVIRONMENT=%~1"
if "%ENVIRONMENT%"=="" set "ENVIRONMENT=prod"
set "TIMESTAMP=%date:~-4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%"

REM Remove spaces from timestamp
set "TIMESTAMP=%TIMESTAMP: =0%"

echo.
echo ===============================================
echo Neighborhood Watch Platform Deployment
echo ===============================================
echo Environment: %ENVIRONMENT%
echo Timestamp: %TIMESTAMP%
echo ===============================================
echo.

REM Check prerequisites
echo [INFO] Checking prerequisites...

REM Check if Vercel CLI is installed
vercel --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Vercel CLI is not installed. Please run: npm install -g vercel
    pause
    exit /b 1
)

REM Check if logged into Vercel
vercel whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Not logged into Vercel. Please run: vercel login
    pause
    exit /b 1
)

REM Check if package.json exists
if not exist "%PROJECT_DIR%package.json" (
    echo [ERROR] package.json not found. Make sure you're in the correct directory.
    pause
    exit /b 1
)

echo [SUCCESS] Prerequisites check passed
echo.

REM Install dependencies
echo [INFO] Installing dependencies...
cd /d "%PROJECT_DIR%"
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)
echo [SUCCESS] Dependencies installed
echo.

REM Build the application
echo [INFO] Building application for %ENVIRONMENT% environment...
if "%ENVIRONMENT%"=="dev" (
    call npm run build -- --mode development
) else if "%ENVIRONMENT%"=="preview" (
    call npm run build -- --mode preview
) else if "%ENVIRONMENT%"=="prod" (
    call npm run build -- --mode production
) else (
    echo [ERROR] Invalid environment: %ENVIRONMENT%. Use: dev, preview, or prod
    pause
    exit /b 1
)

if %errorlevel% neq 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo [SUCCESS] Build completed
echo.

REM Verify build
echo [INFO] Verifying build...

if not exist "%PROJECT_DIR%dist" (
    echo [ERROR] Build directory not found. Build may have failed.
    pause
    exit /b 1
)

if not exist "%PROJECT_DIR%dist\index.html" (
    echo [ERROR] index.html not found in build directory
    pause
    exit /b 1
)

echo [SUCCESS] Build verification passed
echo.

REM Deploy to Vercel
echo [INFO] Deploying to Vercel...
if "%ENVIRONMENT%"=="dev" (
    vercel --dev
) else if "%ENVIRONMENT%"=="preview" (
    vercel --preview
) else if "%ENVIRONMENT%"=="prod" (
    vercel --prod
)

if %errorlevel% neq 0 (
    echo [ERROR] Deployment failed
    pause
    exit /b 1
)
echo [SUCCESS] Deployment completed
echo.

echo ===============================================
echo [SUCCESS] Deployment process completed successfully!
echo ===============================================
echo Next steps:
echo 1. Verify the deployment in your browser
echo 2. Test all major functionality
echo 3. Check the Vercel dashboard for any issues
echo ===============================================

pause