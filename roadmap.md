To implement the handling of the Windows-specific ConPTY cursor position query (`\x1b[6n`) in `worker.ts`, we need to modify the worker to:

1. Receive both the reader and writer handles from the main thread (via `postMessage` in `pty.ts`).
2. In the read loop, check if the read data matches the query sequence.
3. If it does, write the response (`\x1b[1;1R`) back to the writer and skip posting it as a message (to avoid sending "garbage" to the main thread).
4. Otherwise, post the data as usual.

This is Windows-specific behavior, but implementing it cross-platform won't harm other OSes (the sequence won't appear there). For simplicity, we'll handle it unconditionally and assume it's only at startup (so it won't interfere with normal output). If reads are partial/chunked, this exact-match approach might miss it— for production, consider a proper terminal parser like `vte`, but for now, we'll keep it simple as the buffer size (4096) is large enough for startup sequences.

### Step 1: Modify `pty.ts` to Send Both Handles
Update the worker creation in the `Pty` constructor:

```ts
// In pty.ts constructor (around line 55)
if (onMessage) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url));
    this.worker.onmessage = (event) => {
        if (typeof event.data === "string") onMessage(event.data);
    };
    // Change: Send object with both handles (numbers)
    this.worker.postMessage({
        reader: this.reader.handle,
        writer: this.writer.handle
    });

    disposableStack.adopt(this.worker, (worker) => {
        worker.terminate();
    });
}
```

### Step 2: Modify `worker.ts` to Handle the Query
Replace the entire `worker.ts` with this updated version. It imports necessary FFI symbols, receives both handles, replicates the read/write logic (with error handling skipped for brevity), and checks for the sequence.

```ts
import { symbols } from "."; // Import FFI symbols for direct access

// worker.ts
declare var self: Worker;

// Listen for messages from the main thread (now an object with handles)
self.onmessage = (event: MessageEvent<{ reader: number; writer: number }>) => {
    const { reader: readerHandle, writer: writerHandle } = event.data;

    const maxBytes = 4096;
    const buf = Buffer.allocUnsafe(maxBytes);
    const errOut = new BigUint64Array(1); // For error pointers (minimal handling)

    /**
     * Reads data from the PTY.
     *
     * @returns string with read data or null if pipe closed/error
     */
    function read(): string | null {
        const bytesRead = symbols.pty_read(readerHandle, buf, buf.length, errOut);
        if (bytesRead <= 0n) {
            // On error or EOF, log minimally (or handle as needed)
            if (bytesRead === -1n && errOut[0] !== 0n) {
                // Optional: Extract and log error, but skip for now
                symbols.pty_free_err_msg(Number(errOut[0]));
            }
            return null;
        }
        return buf.toString(undefined, 0, Number(bytesRead));
    }

    /**
     * Writes the cursor response to the PTY.
     */
    function writeCursorResponse(): void {
        const response = "\x1b[1;1R";
        const responseBuf = Buffer.from(response);
        const bytesWritten = symbols.pty_write(writerHandle, responseBuf, responseBuf.length, errOut);
        if (bytesWritten === -1n && errOut[0] !== 0n) {
            // Optional: Handle write error
            symbols.pty_free_err_msg(Number(errOut[0]));
        }
    }

    let handledStartupQuery = false; // Optional: Handle only once at startup

    while (true) {
        const data = read();
        if (data === null) {
            // No more data, signal end
            self.postMessage("");
            break;
        }

        // Check for Windows ConPTY cursor query (exact match for simplicity)
        if (!handledStartupQuery && data === "\x1b[6n") {
            writeCursorResponse();
            handledStartupQuery = true; // Prevent repeated handling
            continue; // Skip posting the query as a message
        }

        // Send normal data back to main thread
        self.postMessage(data);
    }
};
```

### Explanation
- **Receiving Handles:** The worker now expects an object `{ reader: number, writer: number }` (raw pointers as numbers).
- **Reading/Writing:** Uses `symbols.pty_read` and `symbols.pty_write` directly (replicating the wrappers in `index.ts`). Error handling is minimal—add `extractErrorMessage` if needed.
- **Query Detection:** Checks if `data === "\x1b[6n"` (the cursor query). If matched (and not already handled), writes the response and skips posting. We use a flag to handle it only once (startup).
- **Why Here?** The worker is responsible for reading output asynchronously, so it's the ideal place to intercept and respond without blocking the main thread.
- **Limitations:** If the sequence is split across reads (rare at startup), this won't catch it. For robustness, accumulate a buffer and parse for ANSI sequences (e.g., using a library like `ansi-escapes` or `vte` ported to JS).
- **Testing:** On Windows, spawn a PTY and check if output starts cleanly (no garbage). Use your test suite—add a Windows-specific test if needed.

After these changes, rebuild the Rust library (`cd rust-wrapper && cargo build --release`), then test with `bun test`. If issues persist, downgrade to portable-pty 0.8.1 in `rust-wrapper/Cargo.toml` as a fallback.