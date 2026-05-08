#!/usr/bin/env bash
set -e

cd artifacts/lesson-plan-api
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

cd ../..
pnpm --filter @workspace/lesson-planner run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM EXIT
wait
