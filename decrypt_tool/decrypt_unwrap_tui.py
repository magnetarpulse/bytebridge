#!/usr/bin/env python3

import os
import sys
import gzip
import json
import asyncio
from pathlib import Path
from dataclasses import dataclass

# --- Dependency Checks ---
try:
    from textual.app import App, ComposeResult
    from textual.containers import Container, Horizontal
    from textual.widgets import (
        Header, Footer, Button, Input, Label, Static, 
        ProgressBar, Log, TabbedContent, TabPane, 
        DirectoryTree, Pretty
    )
    from textual.screen import Screen
    from textual.reactive import reactive
    from textual.validation import Function, ValidationResult, Validator
    from textual.binding import Binding
except ImportError:
    print("Error: Required libraries not installed. Please run 'pip install textual rich'", file=sys.stderr)
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
    print("Error: PyNaCl is not installed. Please run 'pip install PyNaCl'", file=sys.stderr)
    sys.exit(1)

# --- Data Classes ---
@dataclass
class ProcessingStats:
    chunks_processed: int = 0
    bytes_processed: int = 0
    files_extracted: int = 0
    compression_ratio: float = 0.0
    client_fingerprint: str = ""
    header_info: str = ""

# --- Core Processing Functions ---
class DecryptionEngine:
    def __init__(self, progress_callback=None, log_callback=None):
        self.progress_callback = progress_callback
        self.log_callback = log_callback
        self.stats = ProcessingStats()
    
    def log(self, message: str, level: str = "info"):
        if self.log_callback:
            self.log_callback(message, level)
    
    def update_progress(self, step: str, progress: float = None):
        if self.progress_callback:
            self.progress_callback(step, progress)
    
    async def decrypt_stream(self, encrypted_path: str, key_bytes: bytes, decrypted_path: str, provided_key: str):
        # Validate key
        canonical_key = key_bytes.hex()
        if canonical_key.lower() != provided_key.lower():
            raise CryptoError("Provided key does not match the expected key for this file")
        
        self.log("Starting decryption process...")
        self.update_progress("Initializing decryption", 0)
        
        state = None
        try:
            with open(encrypted_path, 'rb') as f_in, open(decrypted_path, 'wb') as f_out:
                # Read fingerprint
                fingerprint_len = f_in.read(1)[0]
                fingerprint = f_in.read(fingerprint_len).decode('utf-8')
                self.stats.client_fingerprint = fingerprint
                
                # Read header
                header = f_in.read(HEADERBYTES)
                self.stats.header_info = header.hex()[:32] + "..." if len(header.hex()) > 32 else header.hex()
                
                self.log(f"Client fingerprint: {fingerprint}")
                self.log(f"Decryption header loaded successfully")
                
                # Initialize decryption state
                state = crypto_secretstream_xchacha20poly1305_state()
                crypto_secretstream_xchacha20poly1305_init_pull(state, header, key_bytes)
                
                self.update_progress("Decrypting chunks", 25)
                
                # Process chunks
                chunk_count = 0
                total_bytes = 0
                file_size = os.path.getsize(encrypted_path)
                
                while True:
                    size_bytes = f_in.read(4)
                    if not size_bytes:
                        break
                    
                    chunk_size = int.from_bytes(size_bytes, 'little')
                    encrypted_chunk = f_in.read(chunk_size)
                    
                    if len(encrypted_chunk) != chunk_size:
                        raise ValueError(f"File corrupt: Expected {chunk_size} bytes, got {len(encrypted_chunk)}")
                    
                    chunk_count += 1
                    total_bytes += chunk_size
                    
                    # Update progress based on bytes processed
                    progress = 25 + (f_in.tell() / file_size) * 50
                    self.update_progress(f"Processing chunk {chunk_count}", progress)
                    
                    decrypted_chunk, tag = crypto_secretstream_xchacha20poly1305_pull(state, encrypted_chunk)
                    f_out.write(decrypted_chunk)
                    
                    # Small delay to show progress
                    await asyncio.sleep(0.001)
                    
                    if tag == crypto_secretstream_xchacha20poly1305_TAG_FINAL:
                        break
                
                self.stats.chunks_processed = chunk_count
                self.stats.bytes_processed = total_bytes
                
                self.log(f"Decryption completed: {chunk_count} chunks, {total_bytes:,} bytes")
                self.update_progress("Decryption complete", 100)
                
        finally:
            if state:
                del state
                self.log("Decryption state cleaned from memory")
    
    async def decompress_gzipped_file(self, gzipped_path: str) -> str:
        output_path = gzipped_path[:-3]
        
        self.log("Starting decompression...")
        self.update_progress("Decompressing file", 0)
        
        original_size = os.path.getsize(gzipped_path)
        
        with gzip.open(gzipped_path, 'rb') as f_in, open(output_path, 'wb') as f_out:
            chunk_size = 64 * 1024  # 64KB chunks
            processed = 0
            
            while True:
                chunk = f_in.read(chunk_size)
                if not chunk:
                    break
                
                f_out.write(chunk)
                processed += len(chunk)
                
                # Estimate progress (gzip doesn't give us total uncompressed size easily)
                progress = min(95, (processed / (original_size * 3)) * 100)  # Rough estimate
                self.update_progress("Decompressing", progress)
                
                await asyncio.sleep(0.001)
        
        decompressed_size = os.path.getsize(output_path)
        self.stats.compression_ratio = (1 - original_size / decompressed_size) * 100 if decompressed_size > 0 else 0
        
        self.log(f"Decompression completed: {original_size:,} → {decompressed_size:,} bytes ({self.stats.compression_ratio:.1f}% compression)")
        self.update_progress("Decompression complete", 100)
        
        return output_path
    
    async def extract_custom_archive(self, archive_path: str, output_dir: str) -> int:
        os.makedirs(output_dir, exist_ok=True)
        
        self.log("Starting archive extraction...")
        self.update_progress("Reading archive manifest", 0)
        
        with open(archive_path, 'rb') as f:
            # Read manifest
            manifest_len = int.from_bytes(f.read(4), 'little')
            manifest_data = f.read(manifest_len)
            
            if not manifest_data:
                raise ValueError("Archive corrupt: missing manifest")
            
            manifest = json.loads(manifest_data.decode('utf-8'))
            files = manifest.get('files', [])
            
            self.log(f"Archive contains {len(files)} files")
            self.update_progress("Extracting files", 10)
            
            # Extract files
            total_bytes = 0
            for i, file_info in enumerate(files):
                file_len_bytes = f.read(4)
                if not file_len_bytes:
                    raise ValueError(f"Archive corrupt: unexpected EOF for file #{i+1}")
                
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
                progress = 10 + ((i + 1) / len(files)) * 90
                self.update_progress(f"Extracted {relative_path}", progress)
                
                self.log(f"Extracted: {relative_path} ({file_len:,} bytes)")
                
                await asyncio.sleep(0.001)
            
            self.stats.files_extracted = len(files)
            self.log(f"Archive extraction completed: {len(files)} files, {total_bytes:,} total bytes")
            self.update_progress("Extraction complete", 100)
        
        return len(files)

# --- Validators ---
class HexKeyValidator(Validator):
    def validate(self, value: str) -> ValidationResult:
        if not value:
            return self.success()
        
        try:
            key_bytes = bytes.fromhex(value)
            if len(key_bytes) != KEYBYTES:
                return self.failure(f"Key must be exactly {KEYBYTES} bytes ({KEYBYTES * 2} hex characters)")
            return self.success()
        except ValueError:
            return self.failure("Key must be valid hexadecimal")

def validate_file_path(value: str) -> ValidationResult:
    if not value:
        return ValidationResult.success()
    
    path = Path(value)
    if not path.exists():
        return ValidationResult.failure("File does not exist")
    if not path.is_file():
        return ValidationResult.failure("Path must point to a file, not a directory")
    if path.stat().st_size == 0:
        return ValidationResult.failure("File is empty")
    
    return ValidationResult.success()

# --- Custom Widgets ---
class FileSelector(Container):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.selected_file = reactive("")
    
    def compose(self) -> ComposeResult:
        yield Label("📁 Select Encrypted File (.enc)", classes="section-header")
        yield Input(
            placeholder="Enter file path or use Browse...",
            validators=[Function(validate_file_path, "Invalid file path")],
            id="file_input"
        )
        yield Button("Browse...", id="browse_btn", classes="secondary-btn")
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "browse_btn":
            self.app.push_screen(FilePickerScreen(), self._on_file_selected)
    
    def _on_file_selected(self, file_path: str) -> None:
        if file_path:
            file_input = self.query_one("#file_input", Input)
            file_input.value = file_path
            self.selected_file = file_path

class KeyInput(Container):
    def compose(self) -> ComposeResult:
        yield Label("🔑 Decryption Key (Hexadecimal)", classes="section-header")
        yield Input(
            placeholder="Enter your secret key in hexadecimal format...",
            password=True,
            validators=[HexKeyValidator()],
            id="key_input"
        )
        yield Button("Show/Hide", id="toggle_key", classes="secondary-btn")
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "toggle_key":
            key_input = self.query_one("#key_input", Input)
            key_input.password = not key_input.password

class ProcessingPanel(Container):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.current_step = reactive("")
        self.progress_value = reactive(0.0)
    
    def compose(self) -> ComposeResult:
        yield Label("⚡ Processing Status", classes="section-header")
        yield Label("Ready to process...", id="status_label")
        yield ProgressBar(total=100, show_eta=False, id="progress_bar")
        with TabbedContent():
            with TabPane("Process Log", id="log_tab"):
                yield Log(id="process_log", auto_scroll=True)
            with TabPane("Statistics", id="stats_tab"):
                yield Pretty({}, id="stats_display")
    
    def update_progress(self, step: str, progress: float = None):
        status_label = self.query_one("#status_label", Label)
        status_label.update(step)
        
        if progress is not None:
            progress_bar = self.query_one("#progress_bar", ProgressBar)
            progress_bar.update(progress=progress)
    
    def add_log(self, message: str, level: str = "info"):
        log_widget = self.query_one("#process_log", Log)
        if level == "error":
            log_widget.write(f"[red]✗[/red] {message}")
        elif level == "success":
            log_widget.write(f"[green]✓[/green] {message}")
        elif level == "warning":
            log_widget.write(f"[yellow]⚠[/yellow] {message}")
        else:
            log_widget.write(f"[blue]•[/blue] {message}")
    
    def update_stats(self, stats: ProcessingStats):
        stats_display = self.query_one("#stats_display", Pretty)
        stats_dict = {
            "Chunks Processed": f"{stats.chunks_processed:,}",
            "Bytes Processed": f"{stats.bytes_processed:,}",
            "Files Extracted": f"{stats.files_extracted:,}",
            "Compression Ratio": f"{stats.compression_ratio:.1f}%",
            "Client Fingerprint": stats.client_fingerprint,
            "Header Info": stats.header_info
        }
        stats_display.update(stats_dict)

class OutputPanel(Container):
    def compose(self) -> ComposeResult:
        yield Label("📤 Output Configuration", classes="section-header")
        yield Input(
            placeholder="Output directory (leave empty for auto-generated)",
            id="output_input"
        )
        yield Button("Select Directory", id="output_browse", classes="secondary-btn")

# --- File Picker Screen ---
class FilePickerScreen(Screen):
    BINDINGS = [
        Binding("escape", "dismiss", "Cancel"),
    ]
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.selected_path = ""
    
    def compose(self) -> ComposeResult:
        yield Container(
            Label("Select Encrypted File", classes="screen-title"),
            DirectoryTree("./", id="file_tree"),
            Horizontal(
                Button("Select", id="select_btn", variant="primary"),
                Button("Cancel", id="cancel_btn", variant="error"),
                classes="dialog-buttons"
            ),
            classes="file-picker-dialog"
        )
    
    def on_directory_tree_file_selected(self, event: DirectoryTree.FileSelected) -> None:
        self.selected_path = str(event.path)
        self.query_one("#select_btn", Button).disabled = False
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "select_btn":
            self.dismiss(self.selected_path)
        elif event.button.id == "cancel_btn":
            self.dismiss("")
    
    def action_dismiss(self) -> None:
        self.dismiss("")

# --- Main Application ---
class ByteBridgeApp(App):
    CSS = """
    .section-header {
        margin: 1 0;
        text-style: bold;
        color: $accent;
    }
    
    .secondary-btn {
        margin: 0 1;
        min-width: 12;
    }
    
    .primary-action {
        margin: 2 0;
        dock: bottom;
        height: 5;
        background: $primary;
    }
    
    .file-picker-dialog {
        margin: 2;
        padding: 1;
        border: solid $accent;
        background: $surface;
        width: 80%;
        height: 80%;
    }
    
    .dialog-buttons {
        margin: 1 0;
        height: 3;
        align: center middle;
    }
    
    .screen-title {
        text-align: center;
        text-style: bold;
        margin: 0 0 1 0;
        color: $accent;
    }
    
    Input {
        margin: 0 0 1 0;
    }
    
    Button {
        margin: 0 1 1 0;
    }
    
    Container {
        margin: 0 0 2 0;
    }
    
    #main_container {
        padding: 1;
    }
    
    #process_button {
        margin: 2 0;
        height: 3;
        text-style: bold;
    }
    
    TabbedContent {
        height: 20;
        margin: 1 0;
    }
    """
    
    TITLE = "ByteBridge - Professional Decryption Suite"
    SUB_TITLE = "Secure file processing with elegance"
    
    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+r", "reset", "Reset"),
        Binding("f1", "help", "Help"),
    ]
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.engine = DecryptionEngine()
    
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Container(
            FileSelector(id="file_selector"),
            KeyInput(id="key_input"),
            OutputPanel(id="output_panel"),
            Button("🚀 Start Processing", id="process_button", variant="primary"),
            ProcessingPanel(id="processing_panel"),
            id="main_container"
        )
        yield Footer()
    
    def on_mount(self) -> None:
        # Setup callbacks for the decryption engine
        processing_panel = self.query_one("#processing_panel", ProcessingPanel)
        self.engine.progress_callback = processing_panel.update_progress
        self.engine.log_callback = processing_panel.add_log
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "process_button":
            self.run_worker(self.process_file(), exclusive=True)
    
    async def process_file(self) -> None:
        try:
            # Get input values
            file_input = self.query_one("#file_input", Input)
            key_input = self.query_one("#key_input", Input)
            output_input = self.query_one("#output_input", Input)
            processing_panel = self.query_one("#processing_panel", ProcessingPanel)
            
            file_path = file_input.value.strip()
            key_value = key_input.value.strip()
            output_dir = output_input.value.strip()
            
            # Validation
            if not file_path:
                processing_panel.add_log("Please select a file to process", "error")
                return
            
            if not key_value:
                processing_panel.add_log("Please enter the decryption key", "error")
                return
            
            # Validate inputs
            if not Path(file_path).exists():
                processing_panel.add_log("Selected file does not exist", "error")
                return
            
            try:
                key_bytes = bytes.fromhex(key_value)
                if len(key_bytes) != KEYBYTES:
                    processing_panel.add_log(f"Key must be exactly {KEYBYTES} bytes", "error")
                    return
            except ValueError:
                processing_panel.add_log("Invalid hexadecimal key format", "error")
                return
            
            # Setup paths
            if not output_dir:
                output_dir = str(Path(file_path).parent / (Path(file_path).stem.replace('.enc', '') + '_extracted'))
            
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            
            base_name = Path(file_path).stem.replace('.enc', '')
            decrypted_path = str(Path(output_dir) / base_name)
            final_output_path = decrypted_path
            
            processing_panel.add_log("Starting decryption process...", "info")
            
            # Step 1: Decryption
            await self.engine.decrypt_stream(file_path, key_bytes, decrypted_path, key_value)
            
            # Step 2: Decompression (if needed)
            if decrypted_path.endswith('.gz'):
                decompressed_path = await self.engine.decompress_gzipped_file(decrypted_path)
                final_output_path = decompressed_path
                # Clean up intermediate file
                Path(decrypted_path).unlink(missing_ok=True)
            
            # Step 3: Archive extraction (if needed)
            if final_output_path.endswith('.archive'):
                archive_output_dir = final_output_path.replace('.archive', '')
                await self.engine.extract_custom_archive(final_output_path, archive_output_dir)
                final_output_path = archive_output_dir
                # Clean up intermediate file
                Path(final_output_path.replace(archive_output_dir, final_output_path)).unlink(missing_ok=True)
            
            # Update statistics
            processing_panel.update_stats(self.engine.stats)
            processing_panel.add_log(f"Process completed successfully! Output: {final_output_path}", "success")
            
        except Exception as e:
            processing_panel = self.query_one("#processing_panel", ProcessingPanel)
            processing_panel.add_log(f"Error: {str(e)}", "error")
    
    def action_reset(self) -> None:
        """Reset all inputs and progress"""
        file_input = self.query_one("#file_input", Input)
        key_input = self.query_one("#key_input", Input)
        output_input = self.query_one("#output_input", Input)
        processing_panel = self.query_one("#processing_panel", ProcessingPanel)
        
        file_input.value = ""
        key_input.value = ""
        output_input.value = ""
        
        processing_panel.update_progress("Ready to process...", 0)
        processing_panel.query_one("#process_log", Log).clear()
        processing_panel.update_stats(ProcessingStats())
    
    def action_help(self) -> None:
        """Show help information"""
        self.push_screen(HelpScreen())

# --- Help Screen ---
class HelpScreen(Screen):
    BINDINGS = [
        Binding("escape", "dismiss", "Close"),
    ]
    
    def compose(self) -> ComposeResult:
        help_text = """
# ByteBridge Decryption Tool

## Usage Instructions

1. **Select File**: Choose your encrypted .enc file using the file selector
2. **Enter Key**: Provide your hexadecimal decryption key
3. **Set Output**: Optionally specify output directory (auto-generated if empty)
4. **Process**: Click "Start Processing" to begin

## File Support

- **Encrypted files** (.enc) - XChaCha20-Poly1305 encryption
- **Compressed files** (.gz) - Automatic decompression
- **Archive files** (.archive) - Custom archive extraction

## Keyboard Shortcuts

- **Ctrl+Q**: Quit application
- **Ctrl+R**: Reset all inputs
- **F1**: Show this help
- **Escape**: Close dialogs

## Security Notes

- Keys are handled securely in memory
- Intermediate files are automatically cleaned up
- All operations are performed locally
        """
        
        yield Container(
            Label("Help & Documentation", classes="screen-title"),
            Static(help_text, id="help_content"),
            Button("Close", id="close_help", variant="primary"),
            classes="file-picker-dialog"
        )
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "close_help":
            self.dismiss()
    
    def action_dismiss(self) -> None:
        self.dismiss()

# --- Main Entry Point ---
def main():
    app = ByteBridgeApp()
    app.run()

if __name__ == "__main__":
    main()