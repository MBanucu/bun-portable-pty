import { ptr } from "bun:ffi";
import { test } from "bun:test";
import {
	asHandle,
	type ChildHandle,
	type MasterHandle,
	type ReaderHandle,
	type SlaveHandle,
	symbols,
	type WriterHandle,
} from "../index.ts";

test("PTY example", () => {
	const masterOut = new BigUint64Array(1); // better than BigInt64Array here
	const slaveOut = new BigUint64Array(1);

	const status = symbols.pty_open(24, 80, ptr(masterOut), ptr(slaveOut));
	if (status !== 0) {
		throw new Error(`pty_open failed: ${status}`);
	}

	const master = asHandle<MasterHandle>(Number(masterOut[0]));
	const slave = asHandle<SlaveHandle>(Number(slaveOut[0]));

	if (!master || !slave) throw new Error("Failed to get handles");

	// Spawn command
	const cmd = Buffer.from("/bin/sh\0"); // helps type inference a bit
	const childRaw = symbols.pty_spawn(slave, ptr(cmd));
	const child = asHandle<ChildHandle>(childRaw);

	if (!child) throw new Error("Failed to spawn command");

	// Get reader & writer
	const readerRaw = symbols.pty_get_reader(master);
	const writerRaw = symbols.pty_get_writer(master);

	const reader = asHandle<ReaderHandle>(readerRaw);
	const writer = asHandle<WriterHandle>(writerRaw);

	if (!reader || !writer) throw new Error("Failed to get reader/writer");

	// ─── Write something ───────────────────────────────────────
	const input = Buffer.from("echo Hello from PTY\n");
	const written = symbols.pty_write(writer, ptr(input), BigInt(input.length));
	console.log("Bytes written:", Number(written));

	// ─── Read output ───────────────────────────────────────────
	const buf = Buffer.alloc(4096);
	const bytesRead = symbols.pty_read(reader, ptr(buf), BigInt(buf.length));

	if (Number(bytesRead) > 0) {
		console.log("Output:", buf.subarray(0, Number(bytesRead)).toString());
	}

	// Resize example
	symbols.pty_resize(master, 30, 120);

	// ─── Cleanup ───────────────────────────────────────────────
	// Order usually doesn't matter much, but good habit: reverse of creation
	symbols.pty_free_reader(reader);
	symbols.pty_free_writer(writer);
	symbols.pty_free_child(child);
	symbols.pty_free_master(master);
	// slave was consumed by spawn → no need to free
});
