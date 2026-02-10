# bun-portable-pty

Portable PTY (pseudo-terminal) bindings for [Bun](https://bun.sh), powered by Rust's `portable-pty` via FFI. Easily spawn cross-platform terminals, interact with processes, and handle terminal IO in Bun scripts—great for shell emulators, REPLs, CLI wrappers, and more.

## Features

- Fast PTY creation and management (via Rust backend)
- Flexible FFI interface for Bun (handle lifecycle, error messages, cleanup)
- Spawn interactive shells or arbitrary commands
- Read/write terminal IO, resize terminal, and dispose handles
- Granular error handling (retrievable error messages)
- Optional worker integration for async data handling
- Thorough TypeScript types for all opaque handles
- Test suite and examples for robust development

## Installation

Clone and install:

```bash
git clone https://github.com/your-user/bun-portable-pty.git
cd bun-portable-pty
bun install
```

Build Rust FFI library (if not prebuilt):

```bash
cd rust-wrapper
cargo build --release
```

The TypeScript side loads the native library from `rust-wrapper/target/release`.

## Quick Start

```ts
import { Pty } from "./pty";

// Spawn a terminal (sh or bash) and interact
using pty = new Pty(24, 80, "/bin/sh", (msg) => console.log("Output:", msg));
pty.write("echo Hello from PTY\n");
pty.write("exit\n");
pty.dispose(); // Automatic via 'using' or manually
```

## API Overview

- `Pty(rows, cols, command, onMessage?)`: Creates and manages PTY + command. Optional worker handles async reads.
- `.write(data: string)`: Writes string to terminal
- `.resize(rows, cols)`: Changes terminal size
- `.dispose()`: Cleans up all resources, ends worker

### Low-Level Usage (FFI symbols)

Expose all handles and FFI calls for manual control:

```ts
import { symbols, asHandle, MasterHandle, SlaveHandle, ... } from "./index";

// Open PTY, spawn command, get reader/writer, perform IO, cleanup
```

## Examples

### Manual FFI Example

```ts
const masterOut = new BigUint64Array(1);
const slaveOut = new BigUint64Array(1);
const status = symbols.pty_open(24, 80, masterOut, slaveOut);
const master = asHandle(masterOut[0]);
const slave = asHandle(slaveOut[0]);
const cmd = Buffer.from("/bin/sh\0");
const errOut = new BigUint64Array(1);
const child = asHandle(symbols.pty_spawn(slave, cmd, errOut));
const reader = asHandle(symbols.pty_get_reader(master));
const writer = asHandle(symbols.pty_get_writer(master));

const input = Buffer.from("echo Hello from PTY\n");
symbols.pty_write(writer, input, input.length);
const buf = Buffer.alloc(4096);
const bytesRead = symbols.pty_read(reader, buf, buf.length);
console.log(buf.subarray(0, bytesRead).toString());

symbols.pty_free_reader(reader);
symbols.pty_free_writer(writer);
symbols.pty_free_child(child);
symbols.pty_free_master(master);
```

## Error Handling

- On errors, Rust FFI returns codes (0=success, -1=error) and CStrings for diagnostics
- Use `extractErrorMessage(errPtr)` to retrieve and free error messages safely

## Advanced: Worker Integration

- To consume terminal output asynchronously, `Pty` can spawn a worker:

```ts
using pty = new Pty(24, 80, "/bin/sh", (msg) => {
    // Handle output chunks here
});
pty.write("echo Hello world\n");
```

## Running Tests

To run tests:

```bash
bun test
```

- Test suite covers spawning shells, error cases, IO, buffers, and worker messages

## Architecture & Roadmap

- Rust backend: uses `portable-pty` for safe terminal interaction; exposes FFI calls for Bun
- TypeScript: loads FFI library, manages resource lifecycles, provides high-level and low-level API
- Error handling, child process management, and command argument support improvements are planned (see `roadmap.md` for details)

## License

MIT. See LICENSE file.

----

Contributions welcome! See roadmap for planned features and improvements.
