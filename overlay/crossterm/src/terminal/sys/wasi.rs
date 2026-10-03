use std::io;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::terminal::WindowSize;

static RAW_MODE: AtomicBool = AtomicBool::new(false);

#[link(wasm_import_module = "tty")]
unsafe extern "C" {
    fn winsize(rows_cols: *mut u16);
    fn raw(on: i32);
}

pub(crate) fn is_raw_mode_enabled() -> bool {
    RAW_MODE.load(Ordering::Relaxed)
}

pub(crate) fn enable_raw_mode() -> io::Result<()> {
    set_raw_mode(true)
}

pub(crate) fn disable_raw_mode() -> io::Result<()> {
    set_raw_mode(false)
}

fn set_raw_mode(on: bool) -> io::Result<()> {
    if RAW_MODE.swap(on, Ordering::Relaxed) != on {
        unsafe { raw(on as i32) };
    }
    Ok(())
}

pub(crate) fn size() -> io::Result<(u16, u16)> {
    let mut size = [0u16; 2];
    unsafe { winsize(size.as_mut_ptr()) };
    Ok((size[1], size[0]))
}

pub(crate) fn window_size() -> io::Result<WindowSize> {
    let (columns, rows) = size()?;
    Ok(WindowSize { rows, columns, width: 0, height: 0 })
}

pub fn supports_keyboard_enhancement() -> io::Result<bool> {
    Ok(false)
}
