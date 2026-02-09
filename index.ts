import { dlopen, FFIType, suffix } from "bun:ffi";
import path from "node:path";

// ───────────────────────────────────────────────
//   Nominal / branded pointer types
// ───────────────────────────────────────────────

export type Pointer<T = unknown> = number & { __pointer__: null; __brand?: T };

export type MasterHandle = Pointer<{ kind: "MasterPty" }>;
export type SlaveHandle = Pointer<{ kind: "SlavePty" }>;
export type ChildHandle = Pointer<{ kind: "Child" }>;
export type ReaderHandle = Pointer<{ kind: "Reader" }>;
export type WriterHandle = Pointer<{ kind: "Writer" }>;

// Optional: union type if you ever want to accept any handle
export type AnyHandle =
	| MasterHandle
	| SlaveHandle
	| ChildHandle
	| ReaderHandle
	| WriterHandle;

// ───────────────────────────────────────────────
//   Library loading
// ───────────────────────────────────────────────

const libPath = path.join(
	import.meta.dir,
	"rust-wrapper/target/release",
	`librust_wrapper.${suffix}`,
);

export const { symbols } = dlopen(libPath, {
	pty_open: {
		args: [FFIType.u16, FFIType.u16, FFIType.ptr, FFIType.ptr],
		returns: FFIType.i32,
	},
	pty_spawn: {
		args: [FFIType.ptr, FFIType.cstring],
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
} as const);

// ───────────────────────────────────────────────
//   Helper to safely cast number → branded pointer
// ───────────────────────────────────────────────

export function asHandle<T>(n: number | null | undefined): Pointer<T> | null {
	if (n == null) return null;
	return n as Pointer<T>;
}
