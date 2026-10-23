#!/usr/bin/env sh
set -eu
docker compose up --build -d
printf '%s\n' 'Demo available at http://localhost:8000/docs'
