#!/bin/bash
set -e
echo "Installing dependencies..."
npm install --legacy-peer-deps
echo "Building application..."
npx vite build
echo "Build completed successfully!"
