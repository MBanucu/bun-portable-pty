import { ptr } from "bun:ffi"; // For ptr if needed in usage
import {
	asHandle,
	type ChildHandle,
	type MasterHandle,
	type ReaderHandle,
	type SlaveHandle,
	symbols,
	type WriterHandle,
} from "./index.ts"; // Assuming this is in the same dir or adjust path

interface Disposable {
	[Symbol.dispose](): void;
}

/**
 * A class wrapper around the PTY FFI functions that manages resources
 * and implements Disposable for automatic cleanup.
 *
 * Usage example:
 * ```ts
 * const pty = new Pty(24, 80, "/bin/sh");
 * const input = Buffer.from("echo Hello\n");
 * pty.write(input);
 * const output = pty.read(4096);
 * console.log(output?.toString());
 * pty.resize(30, 120);
 * pty.dispose(); // Or use in using block if supported
 * ```
 */
export class Pty implements Disposable {
	private master: MasterHandle | null = null;
	private child: ChildHandle | null = null;
	private reader: ReaderHandle | null = null;
	private writer: WriterHandle | null = null;

	/**
	 * Creates a new PTY instance, opens the pair, spawns the command,
	 * and sets up reader/writer.
	 *
	 * @param rows Initial rows
	 * @param cols Initial columns
	 * @param command The command to spawn (e.g., "/bin/sh")
	 * @throws Error if any step fails
	 */
	constructor(rows: number, cols: number, command: string) {
		const masterOut = new BigUint64Array(1);
		const slaveOut = new BigUint64Array(1);

		const status = symbols.pty_open(rows, cols, ptr(masterOut), ptr(slaveOut));
		if (status !== 0) {
			throw new Error(`pty_open failed: ${status}`);
		}

		this.master = asHandle<MasterHandle>(Number(masterOut[0]));
		const slave = asHandle<SlaveHandle>(Number(slaveOut[0]));

		if (!this.master || !slave) {
			this.dispose();
			throw new Error("Failed to get master/slave handles");
		}

		const cmdBuf = Buffer.from(`${command}\0`);
		const childRaw = symbols.pty_spawn(slave, ptr(cmdBuf));
		this.child = asHandle<ChildHandle>(childRaw);

		if (!this.child) {
			this.dispose();
			throw new Error("Failed to spawn command");
		}

		// Note: slave is consumed by spawn, no need to free

		const readerRaw = symbols.pty_get_reader(this.master);
		const writerRaw = symbols.pty_get_writer(this.master);

		this.reader = asHandle<ReaderHandle>(readerRaw);
		this.writer = asHandle<WriterHandle>(writerRaw);

		if (!this.reader || !this.writer) {
			this.dispose();
			throw new Error("Failed to get reader/writer");
		}
	}

	/**
	 * Writes data to the PTY.
	 *
	 * @param data Buffer to write
	 * @returns Number of bytes written, or -1 on error
	 */
	write(data: Buffer): number {
		if (!this.writer) throw new Error("Writer not available");
		const written = symbols.pty_write(
			this.writer,
			ptr(data),
			BigInt(data.length),
		);
		return Number(written);
	}

	/**
	 * Reads data from the PTY.
	 *
	 * @param maxBytes Max bytes to read
	 * @returns Buffer with read data (subarray), or null on error
	 */
	read(maxBytes: number): Buffer | null {
		if (!this.reader) throw new Error("Reader not available");
		const buf = Buffer.alloc(maxBytes);
		const bytesRead = symbols.pty_read(this.reader, ptr(buf), BigInt(maxBytes));
		if (Number(bytesRead) <= 0) return null;
		return buf.subarray(0, Number(bytesRead));
	}

	/**
	 * Resizes the PTY.
	 *
	 * @param rows New rows
	 * @param cols New columns
	 */
	resize(rows: number, cols: number): void {
		if (!this.master) throw new Error("Master not available");
		symbols.pty_resize(this.master, rows, cols);
	}

	/**
	 * Disposes all resources in the correct order.
	 */
	[Symbol.dispose](): void {
		if (this.reader) {
			symbols.pty_free_reader(this.reader);
			this.reader = null;
		}
		if (this.writer) {
			symbols.pty_free_writer(this.writer);
			this.writer = null;
		}
		if (this.child) {
			symbols.pty_free_child(this.child);
			this.child = null;
		}
		if (this.master) {
			symbols.pty_free_master(this.master);
			this.master = null;
		}
		// Slave was consumed, no free needed
	}

	// Optional: for non-symbol dispose compatibility
	dispose(): void {
		this[Symbol.dispose]();
	}
}
