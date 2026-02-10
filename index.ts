import { dlopen, FFIType, ptr, suffix, type Pointer } from "bun:ffi";
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
	const childRaw = symbols.pty_spawn(slave.handle, cmdBuf, argvBuf, argPtrs.length, errOut);

	if (!childRaw) {
		throw new Error(extractErrorMessage(errOut[0]));
	}

	return new ChildHandle(childRaw);
}

export function pty_open(rows: number, cols: number) {
	const masterOut = new BigUint64Array(1);
	const slaveOut = new BigUint64Array(1);
	const status = symbols.pty_open(rows, cols, masterOut, slaveOut);
	const master = Number(masterOut[0]) as Pointer;
	const slave = Number(slaveOut[0]) as Pointer;
	
	using disposableStack = new DisposableStack();
	const masterHandle = master ? disposableStack.use(new MasterHandle(master)) : null;
	const slaveHandle = slave ? disposableStack.use(new SlaveHandle(slave)) : null;
	
	const errorMessages: string[] = [];
	if (!masterHandle) {
		errorMessages.push("pty_open failed to create master handle.");
	}
	if (!slaveHandle) {
		errorMessages.push("pty_open failed to create slave handle.");
	}
	
	if (status !== 0) throw new Error(`pty_open failed: ${status}`);
	if (!masterHandle || !slaveHandle) {
		throw new Error(errorMessages.join(" "));
	} else {
		disposableStack.move();
	}

	return { master: masterHandle, slave: slaveHandle };
}

export function pty_get_reader(master: MasterHandle) {
	const readerRaw = symbols.pty_get_reader(master.handle);
	if (!readerRaw) throw new Error("pty_get_reader failed");
	return new ReaderHandle(readerRaw);
}

export function pty_get_writer(master: MasterHandle) {
	const writerRaw = symbols.pty_get_writer(master.handle);
	if (!writerRaw) throw new Error("pty_get_writer failed");
	return new WriterHandle(writerRaw);
}

export const { symbols } = dlopen(libPath, {
	pty_open: {
		args: [FFIType.u16, FFIType.u16, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_spawn: {
		args: [FFIType.ptr, FFIType.cstring, FFIType.ptr, FFIType.u64, FFIType.ptr],
		returns: FFIType.ptr,
	},
	pty_get_reader: {
		args: [FFIType.ptr],
		returns: FFIType.ptr,
	},
	pty_get_writer: {
		args: [FFIType.ptr],
		returns: FFIType.ptr,
	},
	pty_read: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
		returns: FFIType.i64,
	},
	pty_write: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
		returns: FFIType.i64,
	},
	pty_resize: {
		args: [FFIType.ptr, FFIType.u16, FFIType.u16],
		returns: FFIType.void,
	},
	pty_free_master: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_slave: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_child: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_reader: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_writer: { args: [FFIType.ptr], returns: FFIType.void },
	pty_free_err_msg: { args: [FFIType.ptr], returns: FFIType.void },
} as const);
