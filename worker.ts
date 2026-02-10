import type { ReaderHandle } from ".";
import { symbols } from ".";

// worker.ts
declare var self: Worker;

// Listen for messages from the main thread
self.onmessage = (event: Bun.BunMessageEvent<ReaderHandle>) => {
	const readerHandle = event.data;
	console.log("Worker received:", readerHandle);

	let total = "";
	const maxBytes = 4096;
	const buf = Buffer.allocUnsafe(maxBytes);

	/**
	 * Reads data from the PTY.
	 *
	 * @param maxBytes Max bytes to read
	 * @returns Buffer with read data (subarray), or null on error
	 */
	function read() {
		const bytesRead = symbols.pty_read(readerHandle, buf, maxBytes);
		if (Number(bytesRead) <= 0) return null;
		const outputStr = buf.toString(undefined, 0, Number(bytesRead));
		total += outputStr;
		console.log(`total: ${total}`);
		return outputStr;
	}

	while (true) {
		const data = read();
		if (data) {
			// Send data back to main thread
			self.postMessage(data);
		} else {
			// No more data, break the loop
      self.postMessage("");
			break;
		}
	}
};
