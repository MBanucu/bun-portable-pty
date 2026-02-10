import { expect, test } from "bun:test";
import {
	asHandle,
	type ChildHandle,
	type MasterHandle,
	type ReaderHandle,
	type SlaveHandle,
	symbols,
	type WriterHandle,
} from "../index.ts";

const ffi = require("bun:ffi");

function extractErrorMessage(errPtrNumber: bigint): string {
	const errPtr = Number(errPtrNumber);
	if (errPtr !== 0) {
		const msg = new ffi.CString(errPtr).toString();
		symbols.pty_free_err_msg(errPtr);
		return msg;
	} else {
		return "FFI call failed with no error message";
	}
}

test("pty_spawn handles argv with printf", () => {
	// Open PTY
	const masterOut = new BigUint64Array(1);
	const slaveOut = new BigUint64Array(1);
	const status = symbols.pty_open(24, 80, masterOut, slaveOut);
	expect(status).toBe(0);
	let master = asHandle<MasterHandle>(Number(masterOut[0]));
	let slave = asHandle<SlaveHandle>(Number(slaveOut[0]));
	const errOut = new BigUint64Array(1);
	const prog = Buffer.from("/bin/sh\0");
	const argsArr = [Buffer.from("-c\0"), Buffer.from("printf 'A B C\n'\0")];
	const argPtrs = argsArr.map((arg) => ffi.ptr(arg));
	const argvBuf = Buffer.alloc(argPtrs.length * 8);
	for (let i = 0; i < argPtrs.length; i++) {
		argvBuf.writeBigUInt64LE(BigInt(argPtrs[i]), i * 8);
	}
	const argvPtr = ffi.ptr(argvBuf);
	const childRaw = symbols.pty_spawn(
		slave,
		prog,
		argvPtr,
		argPtrs.length,
		errOut,
	);
	let child = asHandle<ChildHandle>(childRaw);
	slave = null; // slave consumed, cannot free or reuse
	if (!child) throw new Error(extractErrorMessage(errOut[0]));
	let reader = asHandle<ReaderHandle>(symbols.pty_get_reader(master));
	let writer = asHandle<WriterHandle>(symbols.pty_get_writer(master));

	// Send EOF (Ctrl+D)
	symbols.pty_write(writer, Buffer.from("\x04"), 1);

	// Read output, allow up to 3 attempts
	let text = "";
	for (let i = 0; i < 3; i++) {
		const buf = Buffer.alloc(4096);
		const bytesRead = symbols.pty_read(reader, buf, buf.length);
		text += buf.subarray(0, Number(bytesRead)).toString();
		if (text.includes("A B C")) break;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	}
	expect(text).toContain("A B C");
	// Cleanup (null after free for safety)
	symbols.pty_free_reader(reader);
	reader = null;
	symbols.pty_free_writer(writer);
	writer = null;
	symbols.pty_free_child(child);
	child = null;
	symbols.pty_free_master(master);
	master = null;
});
