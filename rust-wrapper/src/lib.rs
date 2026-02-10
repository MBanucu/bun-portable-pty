#![allow(private_interfaces)]
#![allow(dead_code)]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, SlavePty};
use std::ffi::CStr;
use std::ffi::CString;
use std::io::{Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};

// Opaque structs for FFI
struct Master {
    inner: Box<dyn MasterPty + Send>,
}
struct Slave {
    inner: Box<dyn SlavePty + Send>,
}
struct Child {
    inner: Box<dyn portable_pty::Child + Send + Sync>,
}
struct Reader {
    inner: Box<dyn Read + Send>,
}
struct Writer {
    inner: Box<dyn Write + Send>,
}

// Opaque handles for FFI
type MasterHandle = *mut Master;
type SlaveHandle = *mut Slave;
type ChildHandle = *mut Child;
type ReaderHandle = *mut Reader;
type WriterHandle = *mut Writer;

/// Combined function: opens PTY, spawns command, returns master and child.
/// Returns 0 on success, -1 on error; sets out_err_msg (caller frees via pty_free_err_msg).
///
/// # Safety
/// 
/// Caller must ensure:
/// - `prog` is a valid, non-null pointer to a null-terminated C string.
/// - If `argc` > 0, `argv` is a valid, non-null pointer to an array of `argc` pointers, each pointing to a null-terminated C string or null.
/// - `master_out`, `child_out`, and `out_err_msg` are valid, non-null pointers to mutable memory.
/// - The caller must free any error message returned in `out_err_msg` using `pty_free_err_msg`.
/// - Handles returned in `master_out` and `child_out` must be freed using `pty_free_master` and `pty_free_child` respectively.
/// - No aliasing or concurrent mutation of pointers.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_open_and_spawn(
    rows: u16,
    cols: u16,
    prog: *const libc::c_char,
    argv: *const *const libc::c_char,
    argc: usize,
    master_out: *mut MasterHandle,
    child_out: *mut ChildHandle,
    out_err_msg: *mut *mut libc::c_char,
) -> i32 {
    if master_out.is_null() || child_out.is_null() || prog.is_null() {
        let err_str = CString::new("Null pointer provided").unwrap();
        unsafe { *out_err_msg = err_str.into_raw(); }
        return -1;
    }

    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(p) => p,
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Failed to open PTY").unwrap());
                *out_err_msg = err_str.into_raw();
                return -1;
            }
        };

        let prog_cstr = CStr::from_ptr(prog);
        let prog_str = prog_cstr.to_string_lossy().into_owned();
        let mut builder = CommandBuilder::new(prog_str);

        // Parse arguments
        if !argv.is_null() && argc > 0 {
            let args_slice: &[*const libc::c_char] =
                std::slice::from_raw_parts(argv, argc);
            for &arg_ptr in args_slice {
                if arg_ptr.is_null() {
                    continue;
                }
                let arg_cstr = CStr::from_ptr(arg_ptr);
                let arg_str = arg_cstr.to_string_lossy().into_owned();
                builder.arg(arg_str);
            }
        }

        let child = match pair.slave.spawn_command(builder) {
            Ok(c) => c,
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Failed to spawn command").unwrap());
                *out_err_msg = err_str.into_raw();
                // Rollback: drop pair (frees master/slave implicitly)
                drop(pair);
                return -1;
            }
        };

        *master_out = Box::into_raw(Box::new(Master { inner: pair.master }));
        *child_out = Box::into_raw(Box::new(Child { inner: child }));
        0
    }));

    match result {
        Ok(code) => code,
        Err(_) => unsafe {
            let err_str = CString::new("Panic during PTY open/spawn").unwrap();
            *out_err_msg = err_str.into_raw();
            -1
        }
    }
}

/// Get a cloned reader from master
/// Returns 0 on success, -1 on error; sets out_err_msg to error string (caller must free) or null
///
/// # Safety
///
/// Caller must ensure:
/// - `master` is a valid, non-null handle obtained from `pty_open_and_spawn`.
/// - `out_reader` and `out_err_msg` are valid, non-null pointers to mutable memory.
/// - The caller must free the reader handle using `pty_free_reader`.
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent mutation or invalidation of the master handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_get_reader(
    master: MasterHandle,
    out_reader: *mut ReaderHandle,
    out_err_msg: *mut *mut libc::c_char,
) -> i32 {
    if master.is_null() || out_reader.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let master_struct = &mut *master;
        match master_struct.inner.try_clone_reader() {
            Ok(reader) => {
                *out_reader = Box::into_raw(Box::new(Reader { inner: reader }));
                0
            }
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    match result {
        Ok(code) => code,
        Err(_) => unsafe {
            let err_str = CString::new("something is wrong in pty_get_reader").unwrap();
            *out_err_msg = err_str.into_raw();
            -1
        }
    }
}

/// Get the writer from master (can only be called once)
/// Returns 0 on success, -1 on error; sets out_err_msg to error string (caller must free) or null
///
/// # Safety
///
/// Caller must ensure:
/// - `master` is a valid, non-null handle obtained from `pty_open_and_spawn`.
/// - `out_writer` and `out_err_msg` are valid, non-null pointers to mutable memory.
/// - This function is called at most once per master handle.
/// - The caller must free the writer handle using `pty_free_writer`.
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent mutation or invalidation of the master handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_get_writer(
    master: MasterHandle,
    out_writer: *mut WriterHandle,
    out_err_msg: *mut *mut libc::c_char,
) -> i32 {
    if master.is_null() || out_writer.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let master_struct = &mut *master;
        match master_struct.inner.take_writer() {
            Ok(writer) => {
                *out_writer = Box::into_raw(Box::new(Writer { inner: writer }));
                0
            }
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    match result {
        Ok(code) => code,
        Err(_) => unsafe {
            let err_str = CString::new("something is wrong in pty_get_writer").unwrap();
            *out_err_msg = err_str.into_raw();
            -1
        }
    }
}

/// Read from reader handle
/// Returns number of bytes read, -1 on error; sets out_err_msg to error string (caller must free) or null
///
/// # Safety
///
/// Caller must ensure:
/// - `reader` is a valid, non-null handle obtained from `pty_get_reader`.
/// - `buf` is a valid, non-null pointer to mutable memory of at least `len` bytes.
/// - `out_err_msg` is a valid, non-null pointer to mutable memory.
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent access to the reader handle.
/// - `len` does not cause overflow or exceed system limits.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_read(
    reader: ReaderHandle,
    buf: *mut u8,
    len: usize,
    out_err_msg: *mut *mut libc::c_char,
) -> isize {
    if reader.is_null() || buf.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let reader_struct = &mut *reader;
        let slice = std::slice::from_raw_parts_mut(buf, len);
        match reader_struct.inner.read(slice) {
            Ok(bytes) => bytes as isize,
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    match result {
        Ok(res) => res,
        Err(_) => unsafe {
            let err_str = CString::new("something is wrong in pty_read").unwrap();
            *out_err_msg = err_str.into_raw();
            -1
        }
    }
}

/// Write to writer handle
/// Returns number of bytes written, -1 on error; sets out_err_msg to error string (caller must free) or null
///
/// # Safety
///
/// Caller must ensure:
/// - `writer` is a valid, non-null handle obtained from `pty_get_writer`.
/// - `buf` is a valid, non-null pointer to immutable memory of at least `len` bytes.
/// - `out_err_msg` is a valid, non-null pointer to mutable memory.
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent access to the writer handle.
/// - `len` does not cause overflow or exceed system limits.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_write(
    writer: WriterHandle,
    buf: *const u8,
    len: usize,
    out_err_msg: *mut *mut libc::c_char,
) -> isize {
    if writer.is_null() || buf.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let writer_struct = &mut *writer;
        let slice = std::slice::from_raw_parts(buf, len);
        match writer_struct.inner.write(slice) {
            Ok(bytes) => bytes as isize,
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    match result {
        Ok(res) => res,
        Err(_) => unsafe {
            let err_str = CString::new("something is wrong in pty_write").unwrap();
            *out_err_msg = err_str.into_raw();
            -1
        }
    }
}

/// Resize via master
/// Returns 0 on success, -1 on error; sets out_err_msg to error string (caller must free) or null
///
/// # Safety
///
/// Caller must ensure:
/// - `master` is a valid, non-null handle obtained from `pty_open_and_spawn`.
/// - `out_err_msg` is a valid, non-null pointer to mutable memory.
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent mutation or invalidation of the master handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_resize(
    master: MasterHandle,
    rows: u16,
    cols: u16,
    out_err_msg: *mut *mut libc::c_char,
) -> i32 {
    if master.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let master_struct = &mut *master;
        match master_struct.inner.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(_) => 0,
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    match result {
        Ok(code) => code,
        Err(_) => unsafe {
            let err_str = CString::new("something is wrong in pty_resize").unwrap();
            *out_err_msg = err_str.into_raw();
            -1
        }
    }
}

/// Free the master handle.
///
/// # Safety
///
/// Caller must ensure:
/// - `master` is either null or a valid handle obtained from `pty_open_and_spawn`.
/// - The handle is not used after freeing.
/// - No double-free (call at most once per handle).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_free_master(master: MasterHandle) {
    if !master.is_null() {
        unsafe {
            drop(Box::from_raw(master));
        }
    }
}

/// Free the child handle.
///
/// # Safety
///
/// Caller must ensure:
/// - `child` is either null or a valid handle obtained from `pty_open_and_spawn`.
/// - The handle is not used after freeing.
/// - No double-free (call at most once per handle).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_free_child(child: ChildHandle) {
    if !child.is_null() {
        unsafe {
            drop(Box::from_raw(child));
        }
    }
}

/// Free the reader handle.
///
/// # Safety
///
/// Caller must ensure:
/// - `reader` is either null or a valid handle obtained from `pty_get_reader`.
/// - The handle is not used after freeing.
/// - No double-free (call at most once per handle).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_free_reader(reader: ReaderHandle) {
    if !reader.is_null() {
        unsafe {
            drop(Box::from_raw(reader));
        }
    }
}

/// Free the writer handle.
///
/// # Safety
///
/// Caller must ensure:
/// - `writer` is either null or a valid handle obtained from `pty_get_writer`.
/// - The handle is not used after freeing.
/// - No double-free (call at most once per handle).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_free_writer(writer: WriterHandle) {
    if !writer.is_null() {
        unsafe {
            drop(Box::from_raw(writer));
        }
    }
}

/// Free the error message string.
///
/// # Safety
///
/// Caller must ensure:
/// - `ptr` is either null or a valid pointer obtained from an `out_err_msg` parameter.
/// - The pointer is not used after freeing.
/// - No double-free (call at most once per message).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_free_err_msg(ptr: *mut libc::c_char) {
    if !ptr.is_null() {
        unsafe {
            let _ = CString::from_raw(ptr);
        } // Reclaims and drops
    }
}

/// Wait for the child process to exit (blocking).
/// Consumes the child handle.
///
/// # Safety
///
/// Caller must ensure:
/// - `child` is a valid, non-null handle obtained from `pty_open_and_spawn`.
/// - `exit_code_out`, `signal_out`, and `out_err_msg` are valid, non-null pointers to mutable memory.
/// - The handle is not used after this call (consumed).
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent access to the child handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_child_wait(
    child: ChildHandle,
    exit_code_out: *mut i32,
    signal_out: *mut i32,
    out_err_msg: *mut *mut libc::c_char,
) -> i32 {
    if child.is_null() || exit_code_out.is_null() || signal_out.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let mut child_struct = Box::from_raw(child); // Take ownership, consumes the handle
        match child_struct.inner.wait() {
            Ok(status) => {
                *exit_code_out = if status.success() { 0 } else { 1 };
                *signal_out = 0;
                0
            }
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    result.unwrap_or(-1)
}

/// Kill the child process.
///
/// # Safety
///
/// Caller must ensure:
/// - `child` is a valid, non-null handle obtained from `pty_open_and_spawn`.
/// - `out_err_msg` is a valid, non-null pointer to mutable memory.
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent access to the child handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_child_kill(child: ChildHandle, out_err_msg: *mut *mut libc::c_char) -> i32 {
    if child.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let child_struct = &mut *child;
        match child_struct.inner.kill() {
            Ok(_) => 0,
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    result.unwrap_or(-1)
}

/// Check if the child process is alive.
///
/// # Safety
///
/// Caller must ensure:
/// - `child` is a valid, non-null handle obtained from `pty_open_and_spawn`.
/// - No concurrent access to the child handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_child_is_alive(child: ChildHandle) -> i32 {
    if child.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let child_struct = &mut *child;
        match child_struct.inner.try_wait() {
            Ok(Some(_)) => 0, // not alive
            Ok(None) => 1,    // alive
            Err(_) => -1,
        }
    }));
    result.unwrap_or(-1)
}

/// Try to wait for the child process to exit (non-blocking).
///
/// # Safety
///
/// Caller must ensure:
/// - `child` is a valid, non-null handle obtained from `pty_open_and_spawn`.
/// - `exit_code_out`, `signal_out`, and `out_err_msg` are valid, non-null pointers to mutable memory.
/// - The caller must free any error message using `pty_free_err_msg`.
/// - No concurrent access to the child handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pty_child_try_wait(
    child: ChildHandle,
    exit_code_out: *mut i32,
    signal_out: *mut i32,
    out_err_msg: *mut *mut libc::c_char,
) -> i32 {
    if child.is_null() || exit_code_out.is_null() || signal_out.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| unsafe {
        let child_struct = &mut *child;
        match child_struct.inner.try_wait() {
            Ok(Some(status)) => {
                *exit_code_out = if status.success() { 0 } else { 1 };
                *signal_out = 0;
                0 // Exited
            }
            Ok(None) => 1, // Still running
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                -1
            }
        }
    }));
    result.unwrap_or(-1)
}