import { dlopen, FFIType, suffix, CString, ptr } from 'bun:ffi';
import path from 'path';

const libPath: string = path.join(import.meta.dir, 'rust-wrapper/target/release', `librust_wrapper.${suffix}`);

const { symbols } = dlopen(libPath, {
  pty_open: { args: [FFIType.u16, FFIType.u16, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  pty_spawn: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.ptr },
  pty_get_reader: { args: [FFIType.ptr], returns: FFIType.ptr },
  pty_get_writer: { args: [FFIType.ptr], returns: FFIType.ptr },
  pty_read: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
  pty_write: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
  pty_resize: { args: [FFIType.ptr, FFIType.u16, FFIType.u16], returns: FFIType.void },
  pty_free_master: { args: [FFIType.ptr], returns: FFIType.void },
  pty_free_slave: { args: [FFIType.ptr], returns: FFIType.void },
  pty_free_child: { args: [FFIType.ptr], returns: FFIType.void },
  pty_free_reader: { args: [FFIType.ptr], returns: FFIType.void },
  pty_free_writer: { args: [FFIType.ptr], returns: FFIType.void },
});

// Example usage
const masterPtr = new BigInt64Array(1);
const slavePtr = new BigInt64Array(1);
const status = symbols.pty_open(24, 80, ptr(masterPtr), ptr(slavePtr));
if (status !== 0) throw new Error('Failed to open PTY');

const master: bigint = masterPtr[0];
const slave: bigint = slavePtr[0];

// Spawn /bin/sh
const cmd = Buffer.from('/bin/sh\0');
console.log('ptr(cmd):', ptr(cmd));
const child: bigint = symbols.pty_spawn(Number(slave), ptr(cmd));
if (child === 0n) throw new Error('Failed to spawn');

// Get reader and writer
const reader: bigint = symbols.pty_get_reader(Number(master));
if (reader === 0n) throw new Error('Failed to get reader');
const writer: bigint = symbols.pty_get_writer(Number(master));
if (writer === 0n) throw new Error('Failed to get writer');

// Write input
const input: Buffer = Buffer.from('echo Hello from PTY\n');
symbols.pty_write(Number(writer), ptr(input), BigInt(input.length));

// Read output
const buf: Buffer = Buffer.alloc(1024);
const bytesRead: number = Number(symbols.pty_read(Number(reader), ptr(buf), BigInt(buf.length)));
console.log(buf.subarray(0, bytesRead).toString());

// Resize
symbols.pty_resize(Number(master), 30, 100);

// Cleanup (no free_slave since spawned)
symbols.pty_free_reader(Number(reader));
symbols.pty_free_writer(Number(writer));
symbols.pty_free_master(Number(master));
symbols.pty_free_child(Number(child));