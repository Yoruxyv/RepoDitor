use std::{mem::size_of_val, path::Path, ptr};
use windows_sys::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{
            RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
            RRF_SUBKEY_WOW6464KEY,
        },
    },
};

// v0.2.1 electron-builder NSIS UUID derived from io.github.Yoruxyv.repoditor.
const UNINSTALL_KEY: PCWSTR = w!(
    "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7bf293cf-c9df-5f51-b0ff-35bc10c7effc"
);

pub fn is_registered() -> bool {
    [
        (HKEY_CURRENT_USER, "/currentuser"),
        (HKEY_LOCAL_MACHINE, "/allusers"),
    ]
    .into_iter()
    .any(|(hive, scope)| {
        registration_matches(
            registry_value(hive, w!("DisplayName")).as_deref(),
            registry_value(hive, w!("DisplayVersion")).as_deref(),
            registry_value(hive, w!("UninstallString")).as_deref(),
            scope,
        )
    })
}

fn registry_value(hive: HKEY, name: PCWSTR) -> Option<String> {
    let mut buffer = [0u16; 1024];
    let mut size = size_of_val(&buffer) as u32;
    // RegGetValue reads only the pinned key and accepts plain registry strings.
    let result = unsafe {
        RegGetValueW(
            hive,
            UNINSTALL_KEY,
            name,
            RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
            ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if result != ERROR_SUCCESS || !size.is_multiple_of(2) {
        return None;
    }
    let text = buffer.get(..(size / 2) as usize)?.strip_suffix(&[0])?;
    if text.contains(&0) {
        return None;
    }
    String::from_utf16(text).ok()
}

fn registration_matches(
    name: Option<&str>,
    version: Option<&str>,
    uninstall: Option<&str>,
    scope: &str,
) -> bool {
    if name != Some("RepoDitor") || version != Some("0.2.1") {
        return false;
    }
    uninstall.is_some_and(|command| {
        let Some((file, arguments)) = command.strip_prefix('"').and_then(|v| v.split_once('"'))
        else {
            return false;
        };
        let path = Path::new(file);
        arguments.strip_prefix(' ') == Some(scope)
            && path.is_absolute()
            && path
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("Uninstall RepoDitor.exe"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_official_registrations_for_both_install_scopes() {
        for scope in ["/currentuser", "/allusers"] {
            let uninstall = format!(r#""C:\Custom Folder\Uninstall RepoDitor.exe" {scope}"#);
            assert!(registration_matches(
                Some("RepoDitor"),
                Some("0.2.1"),
                Some(&uninstall),
                scope
            ));
        }
    }

    #[test]
    fn missing_or_malformed_registration_and_portable_files_are_ignored() {
        let scope = "/currentuser";
        let valid = r#""C:\Program Files\RepoDitor\Uninstall RepoDitor.exe" /currentuser"#;
        assert!(!registration_matches(None, None, None, scope));
        assert!(!registration_matches(
            Some("RepoDitor"),
            Some("0.2.1"),
            None,
            scope
        ));
        assert!(!registration_matches(
            Some("RepoDitor Desktop"),
            Some("0.2.1"),
            Some(valid),
            scope
        ));
        assert!(!registration_matches(
            Some("RepoDitor"),
            Some("0.3.0"),
            Some(valid),
            scope
        ));
        assert!(!registration_matches(
            Some("RepoDitor"),
            Some("0.2.1"),
            Some(valid),
            "/allusers"
        ));
        for command in [
            "",
            r#""Uninstall RepoDitor.exe" /currentuser"#,
            r#""C:\Portable\RepoDitor.exe" /currentuser"#,
            r#""C:\App\Uninstall RepoDitor.exe" /currentuser /S"#,
            r#"C:\App\Uninstall RepoDitor.exe /currentuser"#,
        ] {
            assert!(!registration_matches(
                Some("RepoDitor"),
                Some("0.2.1"),
                Some(command),
                scope
            ));
        }
    }
}
