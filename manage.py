#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys
import subprocess
import argparse

def clean_pycache(when=""):
    """
    Remove all __pycache__ directories and .pyc/.pyo files.
    
    Args:
        when (str): Indicator of when the cleanup is happening (before/after)
    """
    if os.environ.get('RUN_MAIN') == 'true':
        return
        
    if when:
        print(f"{when} running Django commands, cleaning __pycache__ directories and .pyc/.pyo files...")
    else:
        print("Cleaning __pycache__ directories and .pyc/.pyo files...")
        
    try:
        # Clean __pycache__ directories
        subprocess.run(
            "find . -type d -name '__pycache__' -exec rm -rf {} +",
            shell=True,
            check=True,
            stderr=subprocess.PIPE
        )
        # Clean .pyc/.pyo files
        subprocess.run(
            "find . -name '*.pyc' -o -name '*.pyo' -delete",
            shell=True,
            check=True,
            stderr=subprocess.PIPE
        )
        print("Cleanup completed.")
    except subprocess.CalledProcessError as e:
        print(f"Warning: Cleanup failed: {e.stderr.decode()}")

def main():
    """Run administrative tasks."""
    # Add argument to optionally skip cleanup
    parser = argparse.ArgumentParser(description='Django management command')
    parser.add_argument('--no-cleanup', action='store_true', help='Skip __pycache__ cleanup')
    
    # Extract our custom arguments before passing the rest to Django
    args, django_args = parser.parse_known_args()
    sys.argv = [sys.argv[0]] + django_args
    
    # Clean pycache files before running Django commands if not skipped
    if not args.no_cleanup:
        clean_pycache("Before")
    
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bytebridge.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
        
    execute_from_command_line(sys.argv)
    
    # Clean pycache files after running Django commands if not skipped
    if not args.no_cleanup:
        clean_pycache("After")

if __name__ == '__main__':
    main()