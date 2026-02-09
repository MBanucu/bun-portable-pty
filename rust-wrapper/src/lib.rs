#![allow(clippy::not_unsafe_ptr_arg_deref)]
#![allow(private_interfaces)]
#![allow(dead_code)]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize, SlavePty};
use std::ffi::CStr;
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

// Spawn command on slave, consumes slave handle (no need to free slave after)
// Returns child handle or null on error
#[no_mangle]
pub extern "C" fn pty_spawn(slave: SlaveHandle, cmd: *const libc::c_char) -> ChildHandle {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        let slave_struct = Box::from_raw(slave);
        let slave_box = slave_struct.inner;
        let cmd_cstr = CStr::from_ptr(cmd);
        let cmd_str = cmd_cstr.to_string_lossy().into_owned();
        let builder = CommandBuilder::new(cmd_str);
        let child = slave_box.spawn_command(builder).unwrap();
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
