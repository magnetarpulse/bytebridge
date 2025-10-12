# LZ4 WebAssembly Compression Tool - Installation Guide

This guide provides step-by-step instructions for setting up the LZ4 WebAssembly compression tool, including building the WASM module and configuring both HTML and React test environments.

## Prerequisites

Before proceeding, ensure you have the following installed on your system:

- **Git**: For cloning repositories (tested with v2.43.0)
- **Rust**: The WASM module is built using Rust (tested with rustc 1.70+)
- **wasm-pack**: Tool for building Rust-generated WebAssembly packages (tested with v0.13.1)
- **Node.js and npm**: For the React test environment (tested with Node.js v24.2.0 and npm v11.5.2)
- **Python 3**: For the HTML test server (tested with Python 3.12.3)

### Installing Prerequisites

#### Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

Verify installation:

```bash
rustc --version
```

#### wasm-pack

```bash
cargo install wasm-pack
```

Verify installation:

```bash
wasm-pack --version
```

#### Node.js (if not already installed)

Download from [nodejs.org](https://nodejs.org/) or use your system's package manager.

Verify installation:

```bash
node --version
npm --version
```

#### Git (if not already installed)

Most systems come with Git pre-installed. If not, download from [git-scm.com](https://git-scm.com/).

Verify installation:

```bash
git --version
```

## Building the LZ4 WASM Module

### Step 1: Clone the LZ4 WASM Repository

```bash
git clone https://github.com/PSeitz/lz4-wasm.git
```

### Step 2: Navigate to the Repository

```bash
cd lz4-wasm
```

### Step 3: Build the WASM Package

```bash
RUST_LOG=info wasm-pack build --release --target web
```

**Expected Output:**

```
[INFO]: ✨   Done in xx.xxs
[INFO]: 📦   Your wasm pkg is ready to publish at /path/to/lz4-wasm/pkg.
```

### Step 4: Verify the Build

Check that all required files are present:

```bash
ls -la pkg/
```

**Required files:**

- `LICENSE_APACHE`
- `LICENSE_MIT`
- `README.md`
- `lz4_wasm_nodejs.d.ts`
- `lz4_wasm_nodejs.js`
- `lz4_wasm_nodejs_bg.wasm`
- `lz4_wasm_nodejs_bg.wasm.d.ts`
- `package.json`

## Setting Up Test Environments

### React Test Environment

1. Navigate to the React test directory:

   ```bash
   cd ../lz4-react-test
   ```

2. Copy the WASM package:

   ```bash
   cp -r ../lz4-wasm/pkg ./src/
   ```

3. Install dependencies and start the development server:

   ```bash
   npm install
   npm run dev
   ```

4. Open your browser to `http://localhost:5173` (or the port shown in the terminal).

### HTML Test Environment

1. Navigate to the HTML test directory:

   ```bash
   cd ../lz4-html-test
   ```

2. Copy the WASM package:

   ```bash
   cp -r ../lz4-wasm/pkg ./
   ```

3. Start the Python server:

   ```bash
   ./run.sh
   ```

4. The script will automatically open your browser to the test page.

## Troubleshooting

### Common Issues

**wasm-pack command not found:**

- Ensure `~/.cargo/bin` is in your PATH
- Run `source ~/.cargo/env` or restart your terminal

**Build fails with Rust errors:**

- Update Rust: `rustup update`
- Ensure you have the latest wasm-pack: `cargo install --force wasm-pack`

**React app doesn't load:**

- Check that the `pkg` directory was copied correctly to `src/`
- Verify Node.js version: `node --version` (should be 16+, tested on v24.2.0)
- Verify npm version: `npm --version` (tested on v11.5.2)
- Clear npm cache: `npm cache clean --force`

**Python server issues:**

- Ensure Python 3 is installed: `python3 --version` (tested on 3.12.3)
- Check file permissions: `chmod +x run.sh`

## Next Steps

Once installed, you can:

- Test compression with various file types and sizes
- Compare performance metrics
- Integrate the LZ4 WASM module into your own projects

For more information about LZ4 compression, visit the [official LZ4 website](https://lz4.github.io/lz4/).
For more information about LZ4_flex, visit the [official repository](https://github.com/PSeitz/lz4_flex).

---

**Tested Versions:**

- LZ4 WASM: v0.9.2
- wasm-pack: v0.13.1
- Node.js: v24.2.0
- npm: v11.5.2
- Python: 3.12.3
- Rust: 1.88.0
- Git: 2.43.0

**Last updated:** September 29, 2025
