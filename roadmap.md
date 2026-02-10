### Making bun-portable-pty Cross-Platform (Windows, macOS, Linux)

Your project (`bun-portable-pty`) is already well-positioned for cross-platform support because:
- The Rust backend uses `portable-pty` (v0.9.0), which is designed to work on Windows, macOS, and Linux.
- The TypeScript/Bun frontend uses `bun:ffi`, which handles platform-specific library loading (e.g., `.so` on Linux, `.dylib` on macOS, `.dll` on Windows via the `suffix` export).
- Your test matrix in `tests/pty.test.ts` already accounts for platform differences (e.g., `cmd.exe`, `powershell.exe` on Windows; `sh`, `bash` on Unix-like systems).

However, to ensure full compatibility and automate binary builds via GitHub:
- **Minor Code Adjustments:** Add Windows-specific handling if needed (e.g., default commands, error paths).
- **Build Automation:** Use GitHub Actions to build the Rust shared library (cdylib) for each platform and upload binaries as release artifacts.
- **Distribution:** Users can download prebuilt binaries from GitHub Releases, or build locally.

Below, I'll outline the steps, suggested changes, and a complete GitHub Actions workflow.

#### 1. Code Adjustments for Cross-Platform Compatibility

Your current code should mostly work out-of-the-box, but here are targeted improvements:

- **Handle Windows-Specific Commands:**
  - In `pty.test.ts`, your matrix is good, but ensure tests run on all platforms in CI.
  - In examples/docs, note Windows equivalents (e.g., `new Pty(24, 80, "cmd.exe")` instead of `/bin/sh`).

- **Rust lib.rs Enhancements:**
  - Add null checks and better error handling for Windows-specific issues (e.g., ConPTY quirks in portable-pty).
  - No major changes needed, as `native_pty_system()` abstracts platform differences.

- **TypeScript index.ts and pty.ts:**
  - The library path uses `path.join(import.meta.dir, "rust-wrapper/target/release", `librust_wrapper.${suffix}`);` – this is fine, as `suffix` is platform-aware.
  - For distribution, consider allowing users to specify a custom lib path (e.g., via env var) if downloading prebuilts.

- **Dependencies:**
  - On Windows, ensure Rust is installed with MSVC (default) or GNU toolchain.
  - No extra deps needed beyond what's in Cargo.toml.

- **Local Testing:**
  - **Linux/macOS:** `nix develop` (your flake.nix is great for this).
  - **Windows:** Install Rust (via rustup), Bun, then `cd rust-wrapper && cargo build --release`. Run `bun test`.
  - Test spawning: On Windows, use `cmd.exe` or `powershell.exe`; expect ANSI escape differences.

If issues arise (e.g., Windows PTY resize bugs), check portable-pty docs/issues.

#### 2. Automating Builds with GitHub Actions

We'll create a GitHub Actions workflow (`.github/workflows/build.yml`) that:
- Builds on push/tag/release events.
- Uses a matrix for OS: ubuntu-latest (Linux), macos-latest (macOS), windows-latest (Windows).
- Installs Rust and Bun.
- Builds the Rust cdylib.
- Runs tests.
- Uploads binaries as artifacts (and optionally to releases on tags).

Create the file `.github/workflows/build.yml` with the following content:

```yaml
name: Build and Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  release:
    types: [created]  # Trigger on new releases

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: stable
          components: rustfmt, clippy  # Matches your flake.nix extensions

      - name: Install Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build Rust library
        working-directory: rust-wrapper
        run: cargo build --release --verbose

      - name: Run Rust lints
        working-directory: rust-wrapper
        run: cargo clippy --all-targets -- -D warnings

      - name: Run TypeScript checks
        run: |
          bun run check:bun
          bun run check:ts

      - name: Run tests
        run: bun test

      - name: Prepare artifact
        run: |
          mkdir -p artifacts
          cp rust-wrapper/target/release/librust_wrapper.${{ runner.os == 'Windows' && 'dll' || (runner.os == 'macOS' && 'dylib' || 'so') }} artifacts/

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: bun-portable-pty-${{ matrix.os }}
          path: artifacts/
          retention-days: 5  # Short for PRs/pushes

      - name: Upload to release (on tag)
        if: github.event_name == 'release'
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*
          tag_name: ${{ github.ref_name }}
```

**Explanation:**
- **Matrix:** Builds/tests on all three OSes in parallel.
- **Installs:** Rust via a standard action (includes `rustfmt`, `clippy`); Bun via official setup.
- **Build:** Compiles the Rust cdylib in `rust-wrapper`.
- **Checks/Tests:** Runs your existing scripts (lints, type checks, tests).
- **Artifacts:** Copies the built library (e.g., `librust_wrapper.so` on Linux) to `artifacts/`, uploads as CI artifacts.
- **Releases:** On creating a GitHub Release (e.g., via tag), uploads binaries directly to the release assets.
- **Platform-Specific:** Handles file extensions dynamically.

**Usage:**
- Push to `main` or open a PR: Builds run, artifacts downloadable from the workflow summary.
- Create a release (e.g., `git tag v0.1.0 && git push --tags`): Binaries attached to the release (e.g., download `librust_wrapper.dll` for Windows).

#### 3. Distributing and Using Prebuilt Binaries

- **In Releases:** Users download the platform-specific binary from GitHub Releases and place it in `rust-wrapper/target/release/`.
- **Update README.md:** Add instructions:
  ```
  ## Prebuilt Binaries
  Download from [Releases](https://github.com/your-user/bun-portable-pty/releases):
  - Linux: librust_wrapper.so
  - macOS: librust_wrapper.dylib
  - Windows: librust_wrapper.dll

  Place in `rust-wrapper/target/release/` and run `bun install`.
  ```
- **Optional: npm Package Integration:** If publishing to npm, use `preinstall` to download prebuilts (via `node-fetch` or similar), or use `node-pre-gyp` for binary management.

#### 4. Potential Issues and Troubleshooting

- **Windows Builds:** Ensure Rust is MSVC-based (default). If using GNU, add `rustup target add x86_64-pc-windows-gnu`.
- **Test Failures:** Windows PTY output might have extra CRLF or ANSI differences – adjust assertions in `pty.test.ts` if needed (e.g., normalize line endings).
- **Architecture:** CI uses x64; for arm64 (e.g., M1 macOS), add matrix entries like `os: macos-latest, arch: arm64` and use `rustup target add aarch64-apple-darwin`.
- **Nix on Windows:** Your `flake.nix` won't work on Windows – document separate instructions: "On Windows, install Rust/Bun manually and run `cargo build --release`."
- **Dependencies:** If portable-pty needs Windows-specific deps (rare), check Cargo.lock.

#### 5. Next Steps

- Add the workflow YAML and test it on a branch.
- Update `README.md` with cross-platform notes and binary download instructions.
- If needed, add arm64 support or more tests.

This setup should get your project fully cross-platform with automated builds. If you encounter issues (e.g., Windows-specific bugs), provide logs, and I can refine!