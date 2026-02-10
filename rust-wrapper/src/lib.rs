#![allow(clippy::not_unsafe_ptr_arg_deref)]
#![allow(private_interfaces)]
#![allow(dead_code)]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, SlavePty};
use std::ffi::CStr;
use std::ffi::CString;
use std::io::{Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;

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

// Open PTY pair, return master and slave handles via out params
// Returns 0 on success, -1 on error; sets out_err_msg to error string (caller must free) or null
#[no_mangle]
pub extern "C" fn pty_open(
    rows: u16,
    cols: u16,
    master_out: *mut MasterHandle,
    slave_out: *mut SlaveHandle,
    out_err_msg: *mut *mut libc::c_char,
) -> i32 {
    if master_out.is_null() || slave_out.is_null() {
        return -1;
    }
    let result = catch_unwind(AssertUnwindSafe(|| {
        let pty_system = native_pty_system();
        match pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => {
                unsafe {
                    *master_out = Box::into_raw(Box::new(Master { inner: pair.master }));
                    *slave_out = Box::into_raw(Box::new(Slave { inner: pair.slave }));
                }
                0
            }
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                unsafe {
                    *out_err_msg = err_str.into_raw();
                }
                -1
            }
        }
    }));
    match result {
        Ok(code) => code,
        Err(_) => {
            let err_str = CString::new("something is wrong in pty_open").unwrap();
            unsafe {
                *out_err_msg = err_str.into_raw();
            }
            -1
        }
    }
}

// Spawn command on slave, now supporting argv/argc (program arguments)
// Returns child handle or null on error; sets out_err_msg to error string (caller must free) or null
#[no_mangle]
pub extern "C" fn pty_spawn(
    slave: SlaveHandle,
    prog: *const libc::c_char,
    argv: *const *const libc::c_char,
    argc: usize,
    out_err_msg: *mut *mut libc::c_char,
) -> ChildHandle {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        let slave_struct = Box::from_raw(slave);
        let slave_box = slave_struct.inner;
        let prog_cstr = CStr::from_ptr(prog);
        let prog_str = prog_cstr.to_string_lossy().into_owned();
        let mut builder = CommandBuilder::new(prog_str);

        // Parse arguments
        if argc > 0 {
            let args_slice: Vec<&CStr> = {
                let raw_args = std::slice::from_raw_parts(argv, argc);
                raw_args
                    .iter()
                    .filter_map(|&arg_ptr| {
                        if arg_ptr.is_null() {
                            None
                        } else {
                            Some(CStr::from_ptr(arg_ptr))
                        }
                    })
                    .collect()
            };
            for arg_cstr in args_slice {
                let arg_str = arg_cstr.to_string_lossy().into_owned();
                builder.arg(arg_str);
            }
        }

        let child = match slave_box.spawn_command(builder) {
            Ok(child) => child,
            Err(e) => {
                let err_str = CString::new(e.to_string())
                    .unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                *out_err_msg = err_str.into_raw();
                return ptr::null_mut();
            }
        };
        Box::into_raw(Box::new(Child { inner: child }))
    }))
    .unwrap_or(ptr::null_mut())
}

// Get a cloned reader from master
// Returns 0 on success, -1 on error; sets out_err_msg to error string (caller must free) or null
#[no_mangle]
pub extern "C" fn pty_get_reader(
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
        Err(_) => {
            let err_str = CString::new("something is wrong in pty_get_reader").unwrap();
            unsafe {
                *out_err_msg = err_str.into_raw();
            }
            -1
        }
    }
}

// Get the writer from master (can only be called once)
// Returns 0 on success, -1 on error; sets out_err_msg to error string (caller must free) or null
#[no_mangle]
pub extern "C" fn pty_get_writer(
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
        Err(_) => {
            let err_str = CString::new("something is wrong in pty_get_writer").unwrap();
            unsafe {
                *out_err_msg = err_str.into_raw();
            }
            -1
        }
    }
}

// Read from reader handle
// Returns number of bytes read, -1 on error; sets out_err_msg to error string (caller must free) or null
#[no_mangle]
pub extern "C" fn pty_read(
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
        Err(_) => {
            let err_str = CString::new("something is wrong in pty_read").unwrap();
            unsafe {
                *out_err_msg = err_str.into_raw();
            }
            -1
        }
    }
}

// Write to writer handle
// Returns number of bytes written, -1 on error; sets out_err_msg to error string (caller must free) or null
#[no_mangle]
pub extern "C" fn pty_write(
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
        Err(_) => {
            let err_str = CString::new("something is wrong in pty_write").unwrap();
            unsafe {
                *out_err_msg = err_str.into_raw();
            }
            -1
        }
    }
}

// Resize via master
// Returns 0 on success, -1 on error; sets out_err_msg to error string (caller must free) or null
#[no_mangle]
pub extern "C" fn pty_resize(
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
        Err(_) => {
            let err_str = CString::new("something is wrong in pty_resize").unwrap();
            unsafe {
                *out_err_msg = err_str.into_raw();
            }
            -1
        }
    }
}

// Free functions
#[no_mangle]
pub extern "C" fn pty_free_master(master: MasterHandle) {
    if !master.is_null() {
        unsafe {
            drop(Box::from_raw(master));
        }
    }
}

#[no_mangle]
pub extern "C" fn pty_free_slave(slave: SlaveHandle) {
    if !slave.is_null() {
        unsafe {
            drop(Box::from_raw(slave));
        }
    }
}

#[no_mangle]
pub extern "C" fn pty_free_child(child: ChildHandle) {
    if !child.is_null() {
        unsafe {
            drop(Box::from_raw(child));
        }
    }
}

#[no_mangle]
pub extern "C" fn pty_free_reader(reader: ReaderHandle) {
    if !reader.is_null() {
        unsafe {
            drop(Box::from_raw(reader));
        }
    }
}

#[no_mangle]
pub extern "C" fn pty_free_writer(writer: WriterHandle) {
    if !writer.is_null() {
        unsafe {
            drop(Box::from_raw(writer));
        }
    }
}

#[no_mangle]
pub extern "C" fn pty_free_err_msg(ptr: *mut libc::c_char) {
    if !ptr.is_null() {
        unsafe {
            let _ = CString::from_raw(ptr);
        } // Reclaims and drops
    }
}
