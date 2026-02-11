import { pty_read, pty_write, type ReaderHandle, type WriterHandle } from ".";

// worker.ts
declare var self: Worker;

// Listen for messages from the main thread
self.onmessage = (
	event: Bun.BunMessageEvent<{ reader: ReaderHandle; writer: WriterHandle }>,
) => {
	const { reader: readerHandle, writer: writerHandle } = event.data;

	const maxBytes = 4096;
	const buf = Buffer.allocUnsafe(maxBytes);

	/**
	 * Reads data from the PTY.
	 *
	 * @returns string with read data or null if pipe closed
	 */
	function read() {
		const bytesRead = pty_read(readerHandle, buf);
		if (bytesRead === 0) return null;
		const outputStr = buf.toString(undefined, 0, bytesRead);
		return outputStr;
	}

	/**
	 * Writes the cursor response to the PTY.
	 */
	function writeCursorResponse(): void {
		const response = "\x1b[1;1R";
		pty_write(writerHandle, response);
	}

	let handledStartupQuery = false; // Optional: Handle only once at startup

	while (true) {
		const data = read();
		if (data === null) {
			// No more data, break the loop
			self.postMessage("");
			break;
		}

		// Check for Windows ConPTY cursor query (exact match for simplicity)
		if (!handledStartupQuery && data.includes("\x1b[6n")) {
			writeCursorResponse();
			handledStartupQuery = true; // Prevent repeated handling
			const cleanedData = data.replace("\x1b[6n", ""); // Remove the query from the output
			if (cleanedData) {
				self.postMessage(cleanedData); // Send any remaining data
			}
			continue; // Skip sending the original query back to the main thread
		}
		
		// Send data back to main thread
		self.postMessage(data);
	}
};
