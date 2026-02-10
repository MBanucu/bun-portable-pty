### Error Handling Improvements
The current implementation relies heavily on `unwrap()` for operations that return `Result`, which can lead to panics if errors occur (e.g., in `pty_open`, `pty_get_reader`, `pty_get_writer`, `pty_read`, `pty_write`, and `pty_resize`). While `catch_unwind` catches these panics and returns fallback values like `-1` or `null`, this loses specific error information and isn't ideal for robust FFI usage in Bun, where JavaScript callers might want more diagnostic details.

- **Suggestion**: Replace `unwrap()` with pattern matching on `Result`. For functions that currently lack error messages (unlike `pty_spawn`), add an optional `out_err_msg: *mut *mut libc::c_char` parameter to return a descriptive error string on failure (similar to `pty_spawn`). Caller must free it via `pty_free_err_msg`.
  
  Example for `pty_open`:
  ```rust
  #[no_mangle]
  pub extern "C" fn pty_open(
      rows: u16,
      cols: u16,
      master_out: *mut MasterHandle,
      slave_out: *mut SlaveHandle,
      out_err_msg: *mut *mut libc::c_char,
  ) -> i32 {
      let result = catch_unwind(AssertUnwindSafe(|| {
          let pty_system = native_pty_system();
          match pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }) {
              Ok(pair) => {
                  unsafe {
                      *master_out = Box::into_raw(Box::new(Master { inner: pair.master }));
                      *slave_out = Box::into_raw(Box::new(Slave { inner: pair.slave }));
                  }
                  0
              }
              Err(e) => {
                  let err_str = CString::new(e.to_string()).unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                  unsafe { *out_err_msg = err_str.into_raw(); }
                  -1
              }
          }
      }));
      match result {
          Ok(code) => code,
          Err(_) => -1,
      }
  }
  ```

  Apply similar changes to other functions (e.g., return `-1` and set `out_err_msg` in `pty_get_reader`, `pty_get_writer`, etc.). For `pty_read` and `pty_write`, return `-1` on `Err` and set an error message if added. This allows Bun's JavaScript side to handle errors gracefully, e.g., via `ffi.CString` for messages.

- **Benefit for Bun:ffi**: JS callers can check return codes and retrieve strings for logging or user-facing errors, reducing silent failures.

### Support for Command Arguments in `pty_spawn`
The current `pty_spawn` treats the entire `cmd` string as the program path via `CommandBuilder::new(cmd_str)`, without supporting arguments. This works for simple commands like `/bin/bash` but fails for commands with args (e.g., `ls -l` would treat `"ls -l"` as the program name, leading to "No such file or directory").

- **Suggestion**: Extend the interface to accept an array of arguments. Add parameters `argv: *const *const libc::c_char` (null-terminated array of C strings) and `argc: usize` (optional, for explicit count; fall back to null-termination scanning if 0).

  Example updated signature and implementation:
  ```rust
  #[no_mangle]
  pub extern "C" fn pty_spawn(
      slave: SlaveHandle,
      prog: *const libc::c_char,  // Program path
      argv: *const *const libc::c_char,  // Optional args array
      argc: usize,  // 0 if null-terminated
      out_err_msg: *mut *mut libc::c_char,
  ) -> ChildHandle {
      catch_unwind(AssertUnwindSafe(|| unsafe {
          let slave_struct = Box::from_raw(slave);
          let slave_box = slave_struct.inner;
          let prog_cstr = CStr::from_ptr(prog);
          let prog_str = prog_cstr.to_string_lossy().into_owned();
          let mut builder = CommandBuilder::new(prog_str);

          if !argv.is_null() {
              let args_slice = if argc > 0 {
                  std::slice::from_raw_parts(argv, argc)
              } else {
                  // Scan for null terminator if argc=0
                  let mut args = vec![];
                  let mut ptr = argv;
                  while !(*ptr).is_null() {
                      args.push(*ptr);
                      ptr = ptr.add(1);
                  }
                  args
              };
              for &arg_ptr in args_slice.iter() {
                  if arg_ptr.is_null() { break; }
                  let arg_cstr = CStr::from_ptr(arg_ptr);
                  let arg_str = arg_cstr.to_string_lossy().into_owned();
                  builder.arg(arg_str);
              }
          }

          match slave_box.spawn_command(builder) {
              Ok(child) => Box::into_raw(Box::new(Child { inner: child })),
              Err(e) => {
                  let err_str = CString::new(e.to_string()).unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                  *out_err_msg = err_str.into_raw();
                  ptr::null_mut()
              }
          }
      })).unwrap_or(ptr::null_mut())
  }
  ```

  For backward compatibility, keep `cmd` as `prog`, and if no args, it works as before.

- **Benefit for Bun:ffi**: Allows JS to pass arrays like `ffi.pointer(new Uint8Array([...]))` for args, enabling complex commands (e.g., spawning `git clone repo`). This makes the interface more flexible without relying on shell parsing.

### Child Process Management Functions
The current API provides a `ChildHandle` but no way to interact with it beyond freeing. In PTY use cases, callers often need to wait for exit, check status, or kill the process.

- **Suggestion**: Add functions for common `portable_pty::Child` operations:
  - `pty_child_wait(child: ChildHandle, exit_code_out: *mut i32, signal_out: *mut i32, out_err_msg: *mut *mut libc::c_char) -> i32`: Blocking wait. Waits for the process to exit, sets exit_code_out and signal_out, returns 0 on success, -1 on error. Note: Consumes the child handle; do not use the handle after this call.
  - `pty_child_try_wait(child: ChildHandle, exit_code_out: *mut i32, signal_out: *mut i32, out_err_msg: *mut *mut libc::c_char) -> i32`: Non-blocking try_wait. Sets exit_code_out (or -1 if none), signal_out (for signal if killed), returns 0 if exited, 1 if still running, -1 on error.
  - `pty_child_kill(child: ChildHandle, out_err_msg: *mut *mut libc::c_char) -> i32`: Calls `kill`, returns 0 on success, -1 on error.
  - `pty_child_is_alive(child: ChildHandle) -> i32`: Returns 1 if alive, 0 if not, -1 on error.

  Example for `pty_child_try_wait`:
  ```rust
  #[no_mangle]
  pub extern "C" fn pty_child_try_wait(
      child: ChildHandle,
      exit_code_out: *mut i32,
      signal_out: *mut i32,
      out_err_msg: *mut *mut libc::c_char,
  ) -> i32 {
      catch_unwind(AssertUnwindSafe(|| unsafe {
          let child_struct = &mut *child;
          match child_struct.inner.try_wait() {
              Ok(Some(status)) => {
                  *exit_code_out = if status.success() { 0 } else { 1 };
                  *signal_out = 0;
                  0  // Exited
              }
              Ok(None) => 1,  // Still running
              Err(e) => {
                  let err_str = CString::new(e.to_string()).unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                  *out_err_msg = err_str.into_raw();
                  -1
              }
          }
      })).unwrap_or(-1)
  }
  ```

  Note: `pty_child_wait()` consumes the child handle, so use `pty_child_try_wait()` for non-blocking checks. Callers can loop on `pty_child_try_wait` until exit, then call `pty_child_wait` or free the child.

- **Benefit for Bun:ffi**: Enables JS to manage process lifecycle (e.g., await exit in async code), making the PTY interface complete for terminal emulation or command execution in Bun apps.

### Other Minor Improvements
- **Return Status for `pty_resize`**: Change to return `i32` (0 on success, -1 on error) with optional `out_err_msg`.
  
  ```rust
  #[no_mangle]
  pub extern "C" fn pty_resize(master: MasterHandle, rows: u16, cols: u16, out_err_msg: *mut *mut libc::c_char) -> i32 {
      catch_unwind(AssertUnwindSafe(|| unsafe {
          let master_struct = &mut *master;
          match master_struct.inner.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }) {
              Ok(_) => 0,
              Err(e) => {
                  let err_str = CString::new(e.to_string()).unwrap_or_else(|_| CString::new("Unknown error").unwrap());
                  *out_err_msg = err_str.into_raw();
                  -1
              }
          }
      })).unwrap_or(-1)
  }
  ```

- **Null Pointer Checks**: Add explicit checks for null inputs (e.g., in `pty_read`, `pty_write`) to return -1 immediately, preventing dereference panics.

- **Documentation and Examples**: Add doc comments with C signatures and Bun:ffi usage examples (e.g., how to define JS types with `ffi.dlopen` and handle pointers/buffers).

- **Environment Variables**: Optionally extend `pty_spawn` with `envp: *const *const libc::c_char` for custom env, similar to args.

These changes would make the interface safer, more feature-complete, and better suited for Bun's JS-FFI integration, while keeping it lightweight.