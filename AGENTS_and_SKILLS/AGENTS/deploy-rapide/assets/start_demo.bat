@echo off
setlocal
docker compose up --build -d
if errorlevel 1 exit /b 1
echo Demo available at http://localhost:8000/docs
start "" http://localhost:8000/docs
