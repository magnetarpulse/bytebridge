#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Style/Color Constants ---
CYAN='\033[96m'
SUCCESS='\033[92m'
NC='\033[0m'

# --- Main Script ---
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  Initializing Awesome Project Environment  ${NC}"
echo -e "${CYAN}============================================${NC}"

# 1. Setup Python Virtual Environment
echo -e "\n---> Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "Virtual environment created."
else
    echo "Virtual environment already exists."
fi

# Activate the virtual environment for the rest of this script
source venv/bin/activate
echo -e "${SUCCESS}Virtual environment activated.${NC}"


# 2. Install the 'decrypt-tool' package
echo -e "\n---> Setting up the 'decrypt_tool' component..."
# We call the package's own setup script
bash ./decrypt_tool/setup_package.sh


# 3. (Placeholder) Setup for other components could go here
# echo -e "\n---> Setting up another component..."
# bash ./another_component/setup.sh


echo -e "\n${SUCCESS}==============================================${NC}"
echo -e "${SUCCESS}  Project Initialization Complete!            ${NC}"
echo -e "${SUCCESS}  Run 'source venv/bin/activate' to begin.  ${NC}"
echo -e "${SUCCESS}==============================================${NC}"