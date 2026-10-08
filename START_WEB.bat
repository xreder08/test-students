@echo off
cd /d "%~dp0"
if not exist .env.local (
  echo Configure .env.local using .env.example first.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
set NEXT_TELEMETRY_DISABLED=1
call npm run dev
pause
