//! Retain a Windows object for the host lifetime so the developer CLI can clear offline.

use std::{
    io,
    mem::size_of_val,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    ptr::{null, null_mut},
    slice,
};
use windows_sys::Win32::{
    Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT},
    Security::{GetLengthSid, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER},
    System::Threading::{
        CreateMutexW, GetCurrentProcess, OpenProcessToken, ReleaseMutex, WaitForSingleObject,
    },
};

fn mutex(name: &str) -> io::Result<OwnedHandle> {
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let handle = unsafe { CreateMutexW(null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn account_sid() -> io::Result<String> {
    let mut raw = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut buffer = [0usize; 32];
    let mut size = 0;
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size_of_val(&buffer) as u32,
            &mut size,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    let sid = user.User.Sid;
    let length = if sid.is_null() {
        0
    } else {
        unsafe { GetLengthSid(sid) }
    };
    if !(8..=68).contains(&length) {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let bytes = unsafe { slice::from_raw_parts(sid.cast::<u8>(), length as usize) };
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn retain(fixture: bool) -> io::Result<OwnedHandle> {
    // Keep these names in sync with Python's cache_activity module.
    let scope = if fixture {
        "FixtureArtworkV1"
    } else {
        "ArtworkV1"
    };
    let prefix = format!("Global\\RepoDitorPreview.{scope}.{}", account_sid()?);
    let gate = mutex(&format!("{prefix}.Gate"))?;
    let handle = gate.as_raw_handle();
    match unsafe { WaitForSingleObject(handle, 2_000) } {
        WAIT_OBJECT_0 | WAIT_ABANDONED => {}
        WAIT_TIMEOUT => return Err(io::ErrorKind::WouldBlock.into()),
        _ => return Err(io::Error::last_os_error()),
    }
    let active = mutex(&format!("{prefix}.Active"));
    if unsafe { ReleaseMutex(handle) } == 0 {
        return Err(io::Error::last_os_error());
    }
    active
}
