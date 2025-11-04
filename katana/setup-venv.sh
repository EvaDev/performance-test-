#!/bin/bash
# Setup Python venv for Katana deployment

set -e

echo "Setting up Python virtual environment..."
python3 -m venv venv

echo "Activating venv..."
source venv/bin/activate

echo "Installing starknet-py..."
pip install --upgrade pip
pip install starknet-py

echo ""
echo "✅ Setup complete!"
echo ""
echo "To use:"
echo "  source venv/bin/activate"
echo "  python3 katana/deploy.py"

