#!/usr/bin/env python3

import os
import sys
import gzip
import json
import shutil
import logging
import argparse
import functools
from typing import List, Optional

# --- Dependency Check & Rich Import ---
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    from rich.rule import Rule
    from rich.logging import RichHandler
    from rich.traceback import Traceback
    from rich.table import Table
    from rich.columns import Columns
    from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn
    from rich.align import Align
    from rich.box import ROUNDED
except ImportError:
    print("Error: The 'rich' library is not installed. Please run 'pip install -e .' in the project directory.", file=sys.stderr)
    sys.exit(1)

try:
    from nacl.bindings import (
        crypto_secretstream_xchacha20poly1305_HEADERBYTES as HEADERBYTES,
        crypto_secretstream_xchacha20poly1305_KEYBYTES as KEYBYTES,
        crypto_secretstream_xchacha20poly1305_TAG_FINAL,
        crypto_secretstream_xchacha20poly1305_state,
        crypto_secretstream_xchacha20poly1305_init_pull,
        crypto_secretstream_xchacha20poly1305_pull,
    )
    from nacl.exceptions import CryptoError
except ImportError:
    print("Error: PyNaCl is not installed. Please run 'pip install -e .' in the project directory.", file=sys.stderr)
    sys.exit(1)

# --- Global Components ---
console = Console()
logger = logging.getLogger("rich")

# --- Enhanced UI Components ---
class DebugLogger:
    def __init__(self, console: Console):
        self.console = console
        
    def phase_header(self, phase: str, description: str):
        self.console.print()
        self.console.print(Rule(f"[bold bright_blue]{phase}[/bold bright_blue] [dim]{description}[/dim]", style="bright_blue"))
        self.console.print()
        
    def step_header(self, step: str):
        self.console.print(f"[bold bright_cyan]◆ {step}[/bold bright_cyan]")
        
    def info(self, message: str):
        self.console.print(f"  [bright_green]▸[/bright_green] {message}")
        
    def detail(self, message: str):
        self.console.print(f"    [dim bright_black]◦[/dim bright_black] [dim]{message}[/dim]")
        
    def success(self, message: str):
        self.console.print(f"  [bold bright_green]✓[/bold bright_green] {message}")
        
    def warning(self, message: str):
        self.console.print(f"  [bold bright_yellow]⚠[/bold bright_yellow] {message}")

# --- Core Logic Functions ---

def decrypt_stream(encrypted_path: str, key_bytes: bytes, decrypted_path: str, provided_key: str, debug_logger: Optional[DebugLogger] = None):
    # Use hex encoding for canonical key representation
    canonical_key = key_bytes.hex()
    if canonical_key.lower() != provided_key.lower():
        if debug_logger:
            debug_logger.warning("Key validation failed - provided key does not match expected key")
        raise CryptoError("Provided key does not match the expected key for this file.")

    if debug_logger:
        debug_logger.detail(f"Source: [cyan]{os.path.basename(encrypted_path)}[/cyan]")
        debug_logger.detail(f"Output: [cyan]{os.path.basename(decrypted_path)}[/cyan]")

    state = None
    try:
        with open(encrypted_path, 'rb') as f_in, open(decrypted_path, 'wb') as f_out:
            # Read fingerprint
            fingerprint_len = f_in.read(1)[0]
            fingerprint = f_in.read(fingerprint_len).decode('utf-8')
            
            # Read header
            header = f_in.read(HEADERBYTES)
            
            if debug_logger:
                debug_logger.info(f"Client fingerprint: [bold bright_yellow]{fingerprint}[/bold bright_yellow]")
                debug_logger.info(f"Libsodium header: [bright_yellow]{header.hex()[:32]}{'...' if len(header.hex()) > 32 else ''}[/bright_yellow]")
            
            # Initialize decryption
            state = crypto_secretstream_xchacha20poly1305_state()
            crypto_secretstream_xchacha20poly1305_init_pull(state, header, key_bytes)
            
            if debug_logger:
                debug_logger.success("Decryption state initialized")
            
            # Process chunks
            chunk_count = 0
            total_bytes = 0
            
            while True:
                size_bytes = f_in.read(4)
                if not size_bytes: 
                    break
                    
                chunk_size = int.from_bytes(size_bytes, 'little')
                encrypted_chunk = f_in.read(chunk_size)
                
                if len(encrypted_chunk) != chunk_size:
                    raise ValueError(f"File corrupt: Incomplete chunk. Expected {chunk_size}, got {len(encrypted_chunk)}")
                
                chunk_count += 1
                total_bytes += chunk_size
                
                if debug_logger:
                    debug_logger.detail(f"Chunk {chunk_count:>3}: [cyan]{chunk_size:>8,}[/cyan] bytes")
                
                decrypted_chunk, tag = crypto_secretstream_xchacha20poly1305_pull(state, encrypted_chunk)
                f_out.write(decrypted_chunk)
                
                if tag == crypto_secretstream_xchacha20poly1305_TAG_FINAL:
                    if debug_logger:
                        debug_logger.success(f"Decryption completed - {chunk_count} chunks, {total_bytes:,} bytes processed")
                    break
                    
    finally:
        if state: 
            del state
            if debug_logger:
                debug_logger.detail("Decryption state cleaned from memory")

def decompress_gzipped_file(gzipped_path: str, debug_logger: Optional[DebugLogger] = None) -> str:
    output_path = gzipped_path[:-3]
    
    if debug_logger:
        debug_logger.detail(f"Source: [cyan]{os.path.basename(gzipped_path)}[/cyan]")
        debug_logger.detail(f"Output: [cyan]{os.path.basename(output_path)}[/cyan]")
    
    original_size = os.path.getsize(gzipped_path)
    
    with gzip.open(gzipped_path, 'rb') as f_in, open(output_path, 'wb') as f_out:
        shutil.copyfileobj(f_in, f_out)
    
    decompressed_size = os.path.getsize(output_path)
    
    if debug_logger:
        ratio = (1 - original_size / decompressed_size) * 100 if decompressed_size > 0 else 0
        debug_logger.success(f"Decompressed {original_size:,} → {decompressed_size:,} bytes ({ratio:.1f}% compression)")
    
    return output_path

def extract_custom_archive(archive_path: str, output_dir: str, debug_logger: Optional[DebugLogger] = None) -> int:
    os.makedirs(output_dir, exist_ok=True)
    
    if debug_logger:
        debug_logger.detail(f"Archive: [cyan]{os.path.basename(archive_path)}[/cyan]")
        debug_logger.detail(f"Extract to: [cyan]{os.path.basename(output_dir)}[/cyan]")
    
    with open(archive_path, 'rb') as f:
        # Read manifest
        manifest_len = int.from_bytes(f.read(4), 'little')
        manifest_data = f.read(manifest_len)
        
        if not manifest_data:
            raise ValueError("Archive corrupt: missing manifest.")
            
        manifest = json.loads(manifest_data.decode('utf-8'))
        files = manifest.get('files', [])
        
        if debug_logger:
            debug_logger.info(f"Manifest contains [bold bright_yellow]{len(files)}[/bold bright_yellow] files")
        
        # Extract files
        total_bytes = 0
        for i, file_info in enumerate(files):
            file_len_bytes = f.read(4)
            if not file_len_bytes:
                raise ValueError(f"Archive corrupt: unexpected EOF while reading length for file #{i+1}")
                
            file_len = int.from_bytes(file_len_bytes, 'little')
            file_data = f.read(file_len)
            
            if len(file_data) != file_len:
                raise ValueError(f"Archive corrupt: incomplete data for file #{i+1}")
                
            relative_path = file_info['path']
            output_path = os.path.join(output_dir, relative_path)
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            with open(output_path, 'wb') as out_file:
                out_file.write(file_data)
            
            total_bytes += file_len
            
            if debug_logger:
                debug_logger.detail(f"File {i+1:>3}: [cyan]{relative_path}[/cyan] ({file_len:,} bytes)")
        
        if debug_logger:
            debug_logger.success(f"Extracted {len(files)} files, {total_bytes:,} total bytes")
    
    return len(files)

# --- UI and Helper Functions ---

def setup_logging(is_debug: bool):
    if is_debug:
        # Minimal logging setup for debug mode
        handler = RichHandler(rich_tracebacks=True, markup=True, show_path=False, show_level=False, show_time=False)
        logging.basicConfig(level="DEBUG", format="%(message)s", handlers=[handler])
    else:
        # Suppress most logging in normal mode
        logging.basicConfig(level="ERROR", handlers=[RichHandler(show_path=False)])

def create_file_info_table(file_path: str, key_length: int) -> Table:
    """Create a professional info table for file details"""
    table = Table(box=ROUNDED, show_header=False, padding=(0, 1))
    table.add_column("Property", style="bold bright_cyan", width=15)
    table.add_column("Value", style="bright_white")
    
    file_size = os.path.getsize(file_path)
    table.add_row("File", os.path.basename(file_path))
    table.add_row("Size", f"{file_size:,} bytes")
    table.add_row("Key Length", f"{key_length} bytes")
    table.add_row("Algorithm", "XChaCha20-Poly1305")
    
    return table

def print_error_panel(e: Exception, debug_mode: bool = False):
    """Enhanced error display with better formatting"""
    title = "Error"
    advice = str(e)
    
    if isinstance(e, FileNotFoundError):
        title = "File Not Found"
        advice = f"The specified file could not be found:\n[bold white]{e.filename}[/bold white]"
    elif isinstance(e, CryptoError):
        title = "Decryption Failed"
        advice = "[bold red]Decryption failed[/bold red]\n\nCommon causes:\n• Incorrect secret key\n• Corrupted file\n• File not encrypted with this tool"
    elif isinstance(e, ValueError):
        title = "Invalid Data"
        advice = f"Data processing error:\n[bold white]{str(e)}[/bold white]"
    elif isinstance(e, IsADirectoryError):
        title = "Invalid Input"
        advice = "The specified path is a directory, not a file."
    
    # Create error panel
    error_panel = Panel(
        Align.center(Text.from_markup(advice)),
        title=f"[bold red]✗ {title}[/bold red]",
        border_style="red",
        box=ROUNDED,
        padding=(1, 2)
    )
    
    console.print()
    console.print(error_panel)
    
    if debug_mode:
        console.print()
        console.print("[dim]Debug traceback:[/dim]")
        tb = Traceback.from_exception(
            type(e), e, e.__traceback__, 
            show_locals=True, 
            word_wrap=True,
            width=100
        )
        console.print(tb)

# --- Main Execution Block ---

def main():
    CustomFormatter = functools.partial(argparse.HelpFormatter, max_help_position=45)
    parser = argparse.ArgumentParser(
        description="Professional tool for secure file decryption, decompression, and extraction.", 
        formatter_class=CustomFormatter
    )
    parser.add_argument("--file", type=str, required=True, 
                       help="Path to the encrypted file (.enc)")
    parser.add_argument("--key", type=str, required=True, 
                       help="Hexadecimal secret key for decryption")
    parser.add_argument("--output-dir", type=str, 
                       help="Output directory (default: auto-generated)")
    parser.add_argument("--debug", action="store_true", 
                       help="Enable detailed technical logging")
    
    args = parser.parse_args()
    
    # Setup
    setup_logging(args.debug)
    debug_logger = DebugLogger(console) if args.debug else None
    
    # Header
    header_text = Text("ByteBridge", style="bold bright_cyan")
    header_text.append(" Decrypt & Extract Tool", style="bright_white")
    
    console.print()
    console.print(Panel(
        Align.center(header_text),
        box=ROUNDED,
        border_style="bright_blue",
        padding=(1, 2)
    ))
    
    intermediate_files: List[str] = []

    try:
        # --- Phase 1: Validation ---
        if debug_logger:
            debug_logger.phase_header("PHASE 1", "Input Validation & Setup")
        
        # File validation
        if not os.path.exists(args.file):
            raise FileNotFoundError(args.file)
        if os.path.isdir(args.file):
            raise IsADirectoryError(args.file)
        if os.path.getsize(args.file) == 0:
            raise ValueError("Input file is empty")
        
        # Key validation
        try:
            key_bytes = bytes.fromhex(args.key)
        except ValueError as e:
            raise ValueError(f"Invalid key format: must be valid hexadecimal ({e})")
            
        if len(key_bytes) != KEYBYTES:
            raise ValueError(f"Invalid key length: expected {KEYBYTES} bytes, got {len(key_bytes)}")
        
        if debug_logger:
            debug_logger.success("Input file validation passed")
            debug_logger.success("Decryption key validation passed")
            
            # Show file info in debug mode
            console.print()
            info_table = create_file_info_table(args.file, len(key_bytes))
            console.print(Panel(info_table, title="[bold bright_cyan]File Information[/bold bright_cyan]", box=ROUNDED))
        
        # Setup paths
        output_dir = args.output_dir or os.path.join(
            os.path.dirname(args.file), 
            os.path.basename(args.file).replace('.enc', '_extracted')
        )
        os.makedirs(output_dir, exist_ok=True)
        
        base_name = os.path.basename(args.file).replace('.enc', '')
        decrypted_path = os.path.join(output_dir, base_name)
        final_output_path = decrypted_path
        
        if debug_logger:
            debug_logger.info(f"Output directory: [cyan]{os.path.basename(output_dir)}[/cyan]")
        
        # --- Phase 2: Processing ---
        if debug_logger:
            debug_logger.phase_header("PHASE 2", "File Processing Pipeline")
        
        # Step 1: Decryption
        if debug_logger:
            debug_logger.step_header("Decryption")
            decrypt_stream(args.file, key_bytes, decrypted_path, args.key, debug_logger)
        else:
            with Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]Decrypting file..."),
                BarColumn(),
                console=console,
                transient=True
            ) as progress:
                task = progress.add_task("decrypt", total=None)
                decrypt_stream(args.file, key_bytes, decrypted_path, args.key)
            console.print("[bold bright_green]✓[/bold bright_green] Decryption completed")
        
        # Step 2: Decompression
        if decrypted_path.endswith('.gz'):
            intermediate_files.append(decrypted_path)
            
            if debug_logger:
                debug_logger.step_header("Decompression")
                decompressed_path = decompress_gzipped_file(decrypted_path, debug_logger)
            else:
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[bold blue]Decompressing..."),
                    BarColumn(),
                    console=console,
                    transient=True
                ) as progress:
                    task = progress.add_task("decompress", total=None)
                    decompressed_path = decompress_gzipped_file(decrypted_path)
                console.print("[bold bright_green]✓[/bold bright_green] Decompression completed")
            
            final_output_path = decompressed_path
        else:
            if debug_logger:
                debug_logger.step_header("Decompression")
                debug_logger.warning("Skipped - file is not gzip compressed")
            else:
                console.print("[dim bright_yellow]◦[/dim bright_yellow] Decompression skipped (not gzipped)")

        # Step 3: Archive Extraction
        if final_output_path.endswith('.archive'):
            intermediate_files.append(final_output_path)
            archive_output_dir = final_output_path.replace('.archive', '')
            
            if debug_logger:
                debug_logger.step_header("Archive Extraction")
                num_files = extract_custom_archive(final_output_path, archive_output_dir, debug_logger)
            else:
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[bold blue]Extracting archive..."),
                    BarColumn(),
                    console=console,
                    transient=True
                ) as progress:
                    task = progress.add_task("extract", total=None)
                    num_files = extract_custom_archive(final_output_path, archive_output_dir)
                console.print(f"[bold bright_green]✓[/bold bright_green] Extracted {num_files} files")
            
            final_output_path = archive_output_dir
        else:
            if debug_logger:
                debug_logger.step_header("Archive Extraction")
                debug_logger.warning("Skipped - file is not an archive")
            else:
                console.print("[dim bright_yellow]◦[/dim bright_yellow] Archive extraction skipped (not an archive)")

        # --- Phase 3: Completion ---
        if debug_logger:
            debug_logger.phase_header("PHASE 3", "Process Completion")
            debug_logger.success("All operations completed successfully")

        # Success message
        success_content = Text()
        success_content.append("Process completed successfully!\n\n", style="bold bright_green")
        success_content.append("Output Location:\n", style="bold bright_white")
        success_content.append(os.path.abspath(final_output_path), style="bright_cyan underline")
        
        console.print()
        console.print(Panel(
            Align.center(success_content),
            title="[bold bright_green]✓ Success[/bold bright_green]",
            border_style="bright_green",
            box=ROUNDED,
            padding=(1, 2)
        ))
        console.print()

    except Exception as e:
        print_error_panel(e, args.debug)
        sys.exit(1)
        
    finally:
        # Cleanup intermediate files
        if not args.debug:
            for file_path in intermediate_files:
                if file_path and os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except OSError:
                        pass

if __name__ == '__main__':
    main()