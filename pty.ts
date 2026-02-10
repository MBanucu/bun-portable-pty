import {
	type ChildHandle,
	type MasterHandle,
	pty_get_reader,
	pty_get_writer,
	pty_open,
	pty_spawn,
	pty_write,
	type ReaderHandle,
	symbols,
	type WriterHandle,
} from "./index.ts";
import { extractErrorMessage } from "./src/utils";

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
	// will be used in the future for more advanced features
	private child: ChildHandle;
	private reader: ReaderHandle;
	private writer: WriterHandle;
	private readonly disposableStack: DisposableStack;
	private worker: Worker | null = null;

	/**
	 * Creates a new PTY instance, opens the pair, spawns the command,
	 * and sets up reader/writer. Optionally starts a worker for random messages.
	 *
	 * @param rows Initial rows
	 * @param cols Initial columns
	 * @param cmd The command to spawn (e.g., "/bin/sh")
	 * @param argv Arguments for the command
	 * @param onMessage Optional callback for worker messages
	 * @throws Error if any step fails
	 */
	constructor(
		rows: number,
		cols: number,
		readonly cmd: string,
		readonly argv: readonly string[] = [],
		onMessage?: (message: string) => void,
	) {
		using disposableStack = new DisposableStack();

		const { master, slave } = pty_open(rows, cols);
		disposableStack.use(master);
		this.master = master;

		this.child = disposableStack.use(pty_spawn(slave, cmd, argv));

		this.reader = disposableStack.use(pty_get_reader(this.master));
		this.writer = disposableStack.use(pty_get_writer(this.master));

		if (onMessage) {
			this.worker = new Worker(new URL("./worker.ts", import.meta.url));
			this.worker.onmessage = (event) => {
				if (typeof event.data === "string") onMessage(event.data);
			};
			this.worker.postMessage(this.reader);

			disposableStack.adopt(this.worker, (worker) => {
				worker.terminate();
			});
		}

		this.disposableStack = disposableStack.move();
	}

	/**
	 * Writes data to the PTY.
	 *
	 * @param data string to write
	 * @returns Number of bytes written, or -1 on error
	 */
	write(data: string): number {
		return pty_write(this.writer, data);
	}

	/**
	 * Resizes the PTY.
	 *
	 * @param rows New rows
	 * @param cols New columns
	 */
	resize(rows: number, cols: number): void {
		if (!this.master) throw new Error("Master not available");
		const errOut = new BigUint64Array(1);
		const status = symbols.pty_resize(this.master.handle, rows, cols, errOut);
		if (status !== 0) {
			const errMsg = extractErrorMessage(errOut[0]);
			throw new Error(`pty_resize failed: ${errMsg}`);
		}
	}

	/**
	 * Disposes all resources in the correct order.
	 */
	[Symbol.dispose](): void {
		this.disposableStack.dispose();
		// Slave was consumed, no free needed
	}

	/**
	 * Waits for the child process to exit (non-blocking).
	 * Returns exit code and signal if exited, null if still running.
	 */
	wait(): { exitCode: number | null; signal: number | null } {
		const exitCodeOut = new Int32Array(1);
		const signalOut = new Int32Array(1);
		const errOut = new BigUint64Array(1);
		const status = symbols.pty_child_try_wait(
			this.child.handle,
			exitCodeOut,
			signalOut,
			errOut,
		);
		if (status === -1) {
			const errMsg = extractErrorMessage(errOut[0]);
			throw new Error(`pty_child_try_wait failed: ${errMsg}`);
		} else if (status === 0) {
			// exited
			// biome-ignore lint: style/noNonNullAssertion
			return { exitCode: exitCodeOut[0]!, signal: signalOut[0]! };
		} else {
			// still running
			return { exitCode: null, signal: null };
		}
	}

	/**
	 * Kills the child process.
	 */
	kill(): void {
		const errOut = new BigUint64Array(1);
		const status = symbols.pty_child_kill(this.child.handle, errOut);
		if (status !== 0) {
			const errMsg = extractErrorMessage(errOut[0]);
			throw new Error(`pty_child_kill failed: ${errMsg}`);
		}
	}

	/**
	 * Checks if the child process is alive.
	 */
	isAlive(): boolean {
		const status = symbols.pty_child_is_alive(this.child.handle);
		if (status === 1) return true;
		if (status === 0) return false;
		throw new Error("pty_child_is_alive failed");
	}
}
