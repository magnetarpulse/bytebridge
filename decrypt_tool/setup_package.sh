#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Style/Color Constants ---
INFO='\033[94m'
SUCCESS='\033[92m'
WARNING='\033[93m'
ERROR='\033[91m'
NC='\033[0m' # No Color

# --- Main Script ---
echo -e "${INFO}--- Running Setup for 'decrypt-tool' ---${NC}"

# Ensure the script is run from its own directory to find pyproject.toml
cd "$(dirname "$0")"

# --- Pre-flight Checks ---
echo "1. Performing pre-flight checks..."

# Check 1: Ensure pyproject.toml exists
if [ ! -f "pyproject.toml" ]; then
    echo -e "${ERROR}Error: 'pyproject.toml' not found. This script must be run from the package root directory.${NC}"
    exit 1
fi

# Check 2: Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo -e "${ERROR}Error: python3 is not installed or not in your PATH. Please install Python 3.${NC}"
    exit 1
fi

# Check 3: Check for pip
if ! python3 -m pip --version &> /dev/null; then
    echo -e "${ERROR}Error: pip for python3 is not available. Please ensure your Python installation includes pip.${NC}"
    exit 1
fi

# Check 4: Check if we are in a virtual environment (BEST PRACTICE!)
if [ -z "$VIRTUAL_ENV" ]; then
    echo -e "${WARNING}Warning: You are not in a Python virtual environment (e.g., venv).${NC}"
    echo -e "${WARNING}Installing packages globally is not recommended. It's best to run this from an activated venv.${NC}"
    echo "Continuing in 5 seconds... (Press Ctrl+C to cancel)"
    sleep 5
fi

echo -e "${SUCCESS}All checks passed.${NC}"

# --- Installation ---
echo -e "\n2. Installing 'decrypt-tool' package in editable mode..."

# Use python3 -m pip to be explicit about which pip is used
python3 -m pip install -e .

echo -e "\n${SUCCESS}--- 'decrypt-tool' setup complete! The 'decrypt_unwrap' command is now available. ---${NC}"