import { dlopen, FFIType, suffix, CString, ptr } from 'bun:ffi';
import path from 'path';

const libPath: string = path.join(import.meta.dir, 'rust-wrapper/target/release', `libpty_wrapper.${suffix}`);

const { symbols } = dlopen(libPath, {
  pty_create: { returns: FFIType.ptr },
  pty_get_slave: { args: [FFIType.ptr], returns: FFIType.ptr },
  pty_spawn: { args: [FFIType.ptr, FFIType.cstring, FFIType.ptr], returns: FFIType.ptr },
  pty_read: { args: [FFIType.ptr, FFIType.ptr, FFIType.usize], returns: FFIType.isize },
  pty_write: { args: [FFIType.ptr, FFIType.ptr, FFIType.usize], returns: FFIType.isize },
  pty_resize: { args: [FFIType.ptr, FFIType.u16, FFIType.u16], returns: FFIType.void },
  pty_free_master: { args: [FFIType.ptr], returns: FFIType.void },
  pty_free_slave: { args: [FFIType.ptr], returns: FFIType.void },
  pty_free_child: { args: [FFIType.ptr], returns: FFIType.void },
});

// Example usage: Create PTY, spawn shell, write/read, resize, cleanup
const master = symbols.pty_create();
if (master === null) throw new Error('Failed to create PTY');

const slave = symbols.pty_get_slave(master);  // Typically for internal use
if (slave === null) throw new Error('Failed to get slave PTY');

// Spawn /bin/sh with args (null-terminated array)
const cmd: Uint8Array = new CString('/bin/sh');
const argsPtr: bigint = ptr(new BigInt64Array([BigInt(cmd), 0n]));  // Null-terminated
const child: bigint = symbols.pty_spawn(master, cmd, argsPtr);

// Write input
const input: Buffer = Buffer.from('echo Hello from PTY\n');
symbols.pty_write(master, ptr(input), input.length);

// Read output (allocate buffer)
const buf: Buffer = Buffer.alloc(1024);
const bytesRead: number = Number(symbols.pty_read(master, ptr(buf), buf.length));
console.log(buf.subarray(0, bytesRead).toString());

// Resize
symbols.pty_resize(master, 30, 100);

// Cleanup
symbols.pty_free_child(child);
symbols.pty_free_slave(slave);
symbols.pty_free_master(master);