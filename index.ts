import { dlopen, FFIType, type Pointer, ptr, suffix } from "bun:ffi";
import path from "node:path";
import { extractErrorMessage } from "./src/utils";

export class ReaderHandle implements Disposable {
	readonly handle: Pointer;
	constructor(handle: Pointer) {
		this.handle = handle;
	}

	[Symbol.dispose](): void {
		symbols.pty_free_reader(this.handle);
	}
}

export class WriterHandle implements Disposable {
	readonly handle: Pointer;
	constructor(handle: Pointer) {
		this.handle = handle;
	}

	[Symbol.dispose](): void {
		symbols.pty_free_writer(this.handle);
	}
}

export class MasterHandle implements Disposable {
	readonly handle: Pointer;
	constructor(handle: Pointer) {
		this.handle = handle;
	}

	[Symbol.dispose](): void {
		symbols.pty_free_master(this.handle);
	}
}

export class SlaveHandle implements Disposable {
	readonly handle: Pointer;
	constructor(handle: Pointer) {
		this.handle = handle;
	}

	[Symbol.dispose](): void {
		symbols.pty_free_slave(this.handle);
	}
}

export class ChildHandle implements Disposable {
	readonly handle: Pointer;
	constructor(handle: Pointer) {
		this.handle = handle;
	}

	[Symbol.dispose](): void {
		symbols.pty_free_child(this.handle);
	}
}

const libPath = path.join(
	import.meta.dir,
	"rust-wrapper/target/release",
	`librust_wrapper.${suffix}`,
);

export function pty_spawn(
	slave: SlaveHandle,
	cmd: string,
	argv: readonly string[],
) {
	const errOut = new BigUint64Array(1);
	errOut[0] = BigInt(0);
	const cmdBuf = Buffer.from(`${cmd}\0`);

	const argvBuf = Buffer.alloc(argv.length * 8);
	const argPtrs = argv.map((arg) => Buffer.from(`${arg}\0`)).map(ptr);
	for (let i = 0; i < argPtrs.length; i++) {
		const argPtr = argPtrs[i];
		if (argPtr) argvBuf.writeBigUInt64LE(BigInt(argPtr), i * 8);
	}
	const childRaw = symbols.pty_spawn(
		slave.handle,
		cmdBuf,
		argvBuf,
		argPtrs.length,
		errOut,
	);

	if (!childRaw) {
		throw new Error(extractErrorMessage(errOut[0]));
	}

	return new ChildHandle(childRaw);
}

export function pty_open(rows: number, cols: number) {
	const masterOut = new BigUint64Array(1);
	const slaveOut = new BigUint64Array(1);
	const errOut = new BigUint64Array(1);
	const status = symbols.pty_open(rows, cols, masterOut, slaveOut, errOut);
	const master = Number(masterOut[0]) as Pointer;
	const slave = Number(slaveOut[0]) as Pointer;

	using disposableStack = new DisposableStack();
	const masterHandle = master
		? disposableStack.use(new MasterHandle(master))
		: null;
	const slaveHandle = slave
		? disposableStack.use(new SlaveHandle(slave))
		: null;

	const errorMessages: string[] = [];
	if (!masterHandle) {
		errorMessages.push("pty_open failed to create master handle.");
	}
	if (!slaveHandle) {
		errorMessages.push("pty_open failed to create slave handle.");
	}

	if (status !== 0) {
		const errMsg = extractErrorMessage(errOut[0]);
		throw new Error(`pty_open failed: ${errMsg}`);
	}
	if (!masterHandle || !slaveHandle) {
		throw new Error(errorMessages.join(" "));
	} else {
		disposableStack.move();
	}

	return { master: masterHandle, slave: slaveHandle };
}

export function pty_get_reader(master: MasterHandle) {
	const readerOut = new BigUint64Array(1);
	const errOut = new BigUint64Array(1);
	const status = symbols.pty_get_reader(master.handle, readerOut, errOut);
	if (status !== 0) {
		const errMsg = extractErrorMessage(errOut[0]);
		throw new Error(`pty_get_reader failed: ${errMsg}`);
	}
	const reader = Number(readerOut[0]) as Pointer;
	if (!reader) throw new Error("pty_get_reader failed to create reader handle");
	return new ReaderHandle(reader);
}

export function pty_get_writer(master: MasterHandle) {
	const writerOut = new BigUint64Array(1);
	const errOut = new BigUint64Array(1);
	const status = symbols.pty_get_writer(master.handle, writerOut, errOut);
	if (status !== 0) {
		const errMsg = extractErrorMessage(errOut[0]);
		throw new Error(`pty_get_writer failed: ${errMsg}`);
	}
	const writer = Number(writerOut[0]) as Pointer;
	if (!writer) throw new Error("pty_get_writer failed to create writer handle");
	return new WriterHandle(writer);
}

export function pty_read(reader: ReaderHandle, buf: Buffer) {
	const errOut = new BigUint64Array(1);
	const bytesRead = symbols.pty_read(reader.handle, buf, buf.length, errOut);
	if (bytesRead === -1n) {
		const errMsg = extractErrorMessage(errOut[0]);
		throw new Error(`pty_read failed: ${errMsg}`);
	}
	return Number(bytesRead);
}

export function pty_write(writer: WriterHandle, text: string) {
	const errOut = new BigUint64Array(1);
	const buf = Buffer.from(`${text}\0`);
	const bytesWritten = symbols.pty_write(
		writer.handle,
		buf,
		buf.length,
		errOut,
	);
	if (bytesWritten === -1n) {
		const errMsg = extractErrorMessage(errOut[0]);
		throw new Error(`pty_write failed: ${errMsg}`);
	}
	return Number(bytesWritten);
}

export const { symbols } = dlopen(libPath, {
	pty_open: {
		args: [FFIType.u16, FFIType.u16, FFIType.ptr, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_spawn: {
		args: [FFIType.ptr, FFIType.cstring, FFIType.ptr, FFIType.u64, FFIType.ptr],
		returns: FFIType.ptr,
	},
	pty_get_reader: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_get_writer: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_read: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
		returns: FFIType.i64,
	},
	pty_write: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
		returns: FFIType.i64,
	},
	pty_resize: {
		args: [FFIType.ptr, FFIType.u16, FFIType.u16, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_child_wait: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_child_try_wait: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_child_kill: {
		args: [FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_child_is_alive: {
		args: [FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_free_master: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_slave: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_child: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_reader: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_writer: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_err_msg: { args: [FFIType.ptr], returns: FFIType.void },
} as const);
