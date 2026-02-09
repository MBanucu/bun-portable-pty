// pty.ts (updated)

import { CString, ptr } from "bun:ffi"; // For ptr if needed in usage
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
 * const pty = new Pty(24, 80, "/bin/sh", (msg) => console.log("Received:", msg));
 * const input = Buffer.from("echo Hello\n");
 * pty.write(input);
 * const output = pty.read(4096);
 * console.log(output?.toString());
 * pty.resize(30, 120);
 * pty.dispose(); // Or use in using block if supported
 * ```
 */
export class Pty implements Disposable {
	private master: MasterHandle;
	private child: ChildHandle;
	private reader: ReaderHandle;
	private writer: WriterHandle;
	private worker: Worker | null = null;

	/**
	 * Creates a new PTY instance, opens the pair, spawns the command,
	 * and sets up reader/writer. Optionally starts a worker for random messages.
	 *
	 * @param rows Initial rows
	 * @param cols Initial columns
	 * @param command The command to spawn (e.g., "/bin/sh")
	 * @param onMessage Optional callback for worker messages
	 * @throws Error if any step fails
	 */
	constructor(rows: number, cols: number, command: string, onMessage?: (message: string) => void) {
		const masterOut = new BigUint64Array(1);
		const slaveOut = new BigUint64Array(1);

		const status = symbols.pty_open(rows, cols, masterOut, slaveOut);
		if (status !== 0) {
			throw new Error(`pty_open failed: ${status}`);
		}

		const master = asHandle<MasterHandle>(Number(masterOut[0]));
		const slave = asHandle<SlaveHandle>(Number(slaveOut[0]));

		if (!master || !slave) {
			if (master) symbols.pty_free_master(master);
			if (slave) symbols.pty_free_slave(slave);
			throw new Error("Failed to get master/slave handles");
		}
		this.master = master;

		const cmdBuf = Buffer.from(`${command}\0`);
		const childRaw = symbols.pty_spawn(slave, cmdBuf);
		const child = asHandle<ChildHandle>(childRaw);

		if (!child) {
			symbols.pty_free_master(master);
			symbols.pty_free_slave(slave);
			throw new Error("Failed to spawn command");
		}
		this.child = child;

		// Note: slave is consumed by spawn, no need to free

		const readerRaw = symbols.pty_get_reader(this.master);
		const writerRaw = symbols.pty_get_writer(this.master);

		const reader = asHandle<ReaderHandle>(readerRaw);
		const writer = asHandle<WriterHandle>(writerRaw);

		if (!reader || !writer) {
			if (reader) symbols.pty_free_reader(reader);
			if (writer) symbols.pty_free_writer(writer);
			symbols.pty_free_child(this.child);
			symbols.pty_free_master(this.master);
			throw new Error("Failed to get reader/writer");
		}
		this.reader = reader;
		this.writer = writer;

		// Set up optional worker for random messages
		if (onMessage) {
			this.worker = new Worker(new URL("./worker.ts", import.meta.url));
			this.worker.onmessage = (event) => {
				if (typeof event.data === "string") {
					onMessage(event.data);
				}
			};
		}
	}

	/**
	 * Writes data to the PTY.
	 *
	 * @param data string to write
	 * @returns Number of bytes written, or -1 on error
	 */
	write(data: string): number {
		if (!this.writer) throw new Error("Writer not available");
		const buf = Buffer.from(data);
		const written = symbols.pty_write(this.writer, buf, buf.length);
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
		const bytesRead = symbols.pty_read(this.reader, buf, maxBytes);
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
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		symbols.pty_free_reader(this.reader);
		symbols.pty_free_writer(this.writer);
		symbols.pty_free_child(this.child);
		symbols.pty_free_master(this.master);
		// Slave was consumed, no free needed
	}
}