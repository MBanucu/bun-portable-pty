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
// Returns 0 on success, -1 on error
#[no_mangle]
pub extern "C" fn pty_open(
    rows: u16,
    cols: u16,
    master_out: *mut MasterHandle,
    slave_out: *mut SlaveHandle,
) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        unsafe {
            *master_out = Box::into_raw(Box::new(Master { inner: pair.master }));
            *slave_out = Box::into_raw(Box::new(Slave { inner: pair.slave }));
        }
        0
    }));
    match result {
        Ok(_) => 0,
        Err(_) => -1,
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
        if !argv.is_null() {
            let args_slice: Vec<&CStr> = if argc > 0 {
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
            } else {
                // Null-terminated scan
                let mut args = vec![];
                let mut ptr_idx = 0;
                loop {
                    let arg_ptr = *argv.add(ptr_idx);
                    if arg_ptr.is_null() {
                        break;
                    }
                    args.push(CStr::from_ptr(arg_ptr));
                    ptr_idx += 1;
                }
                args
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
#[no_mangle]
pub extern "C" fn pty_get_reader(master: MasterHandle) -> ReaderHandle {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        let master_struct = &mut *master;
        let master_ref = &mut master_struct.inner;
        let reader = master_ref.try_clone_reader().unwrap();
        Box::into_raw(Box::new(Reader { inner: reader }))
    }))
    .unwrap_or(ptr::null_mut())
}

// Get the writer from master (can only be called once)
#[no_mangle]
pub extern "C" fn pty_get_writer(master: MasterHandle) -> WriterHandle {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        let master_struct = &mut *master;
        let master_ref = &mut master_struct.inner;
        let writer = master_ref.take_writer().unwrap();
        Box::into_raw(Box::new(Writer { inner: writer }))
    }))
    .unwrap_or(ptr::null_mut())
}

// Read from reader handle
#[no_mangle]
pub extern "C" fn pty_read(reader: ReaderHandle, buf: *mut u8, len: usize) -> isize {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        let reader_struct = &mut *reader;
        let reader_ref = &mut reader_struct.inner;
        let slice = std::slice::from_raw_parts_mut(buf, len);
        reader_ref.read(slice).unwrap() as isize
    }))
    .unwrap_or(-1)
}

// Write to writer handle
#[no_mangle]
pub extern "C" fn pty_write(writer: WriterHandle, buf: *const u8, len: usize) -> isize {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        let writer_struct = &mut *writer;
        let writer_ref = &mut writer_struct.inner;
        let slice = std::slice::from_raw_parts(buf, len);
        writer_ref.write(slice).unwrap() as isize
    }))
    .unwrap_or(-1)
}

// Resize via master
#[no_mangle]
pub extern "C" fn pty_resize(master: MasterHandle, rows: u16, cols: u16) {
    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
        let master_struct = &mut *master;
        let master_ref = &mut master_struct.inner;
        master_ref
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
    }));
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
