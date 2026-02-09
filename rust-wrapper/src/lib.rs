use portable_pty::{
    native_pty_system, CommandBuilder, MasterPty, PtyPair, PtySize, PtySystem, SlavePty,
};
use std::ffi::{CStr, CString};
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt; // for Path-like, but we use String here
use std::panic::catch_unwind;
use std::path::Path;
use std::ptr;

// Opaque handles
type MasterHandle = *mut Box<dyn MasterPty + Send>;
type ChildHandle = *mut Box<dyn portable_pty::Child + Send>;

// Combined create and spawn
#[no_mangle]
pub extern "C" fn pty_open_and_spawn(
    cmd_ptr: *const libc::c_char,
    args_ptr: *const *const libc::c_char,
    master_out: *mut MasterHandle,
    child_out: *mut ChildHandle,
) -> libc::c_int {
    catch_unwind(|| unsafe {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();

        let cmd_cstr = CStr::from_ptr(cmd_ptr);
        let cmd_str = cmd_cstr.to_string_lossy().into_owned();

        let mut builder = CommandBuilder::new(cmd_str);

        let mut i = 0;
        while !(*args_ptr.offset(i)).is_null() {
            let arg_cstr = CStr::from_ptr(*args_ptr.offset(i));
            builder.arg(arg_cstr.to_string_lossy().into_owned());
            i += 1;
        }

        let child = pair.slave.spawn_command(builder).unwrap();

        *master_out = Box::into_raw(Box::new(pair.master)) as MasterHandle;
        *child_out = Box::into_raw(Box::new(child)) as ChildHandle;

        0 // success
    })
    .unwrap_or(-1)
}

// Read using try_clone_reader
#[no_mangle]
pub extern "C" fn pty_read(master: MasterHandle, buf: *mut u8, len: usize) -> isize {
    catch_unwind(|| unsafe {
        let master_ref = &mut *master;
        if let Ok(mut reader) = master_ref.try_clone_reader() {
            let slice = std::slice::from_raw_parts_mut(buf, len);
            reader.read(slice).unwrap_or(0) as isize
        } else {
            -1
        }
    })
    .unwrap_or(-1)
}

// Similar for write using take_writer()
#[no_mangle]
pub extern "C" fn pty_write(master: MasterHandle, buf: *const u8, len: usize) -> isize {
    catch_unwind(|| unsafe {
        let master_ref = &mut *master;
        if let Ok(mut writer) = master_ref.take_writer() {
            let slice = std::slice::from_raw_parts(buf, len);
            writer.write(slice).unwrap_or(0) as isize
        } else {
            -1
        }
    })
    .unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn pty_resize(master: MasterHandle, rows: u16, cols: u16) {
    let _ = catch_unwind(|| unsafe {
        let master_ref = &mut *master;
        let _ = master_ref.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    });
}

#[no_mangle]
pub extern "C" fn pty_free_master(master: MasterHandle) {
    if !master.is_null() {
        unsafe {
            drop(Box::from_raw(master));
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
