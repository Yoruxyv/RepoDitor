const PROJECT_SOURCE_URL: &str = "https://github.com/Yoruxyv/RepoDitor";

pub(crate) fn handle_project_window(url: &tauri::Url, open: impl FnOnce(&str)) {
    let target = url.as_str();
    let release = target
        .strip_prefix(PROJECT_SOURCE_URL)
        .and_then(|path| path.strip_prefix("/releases/tag/"))
        .is_some_and(|tag| {
            !tag.is_empty()
                && tag.len() <= 129
                && tag
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
        });
    if target == PROJECT_SOURCE_URL
        || target.strip_prefix(PROJECT_SOURCE_URL) == Some("/releases")
        || release
    {
        open(target);
    }
}

pub(crate) fn open_system_url(target: &str) -> bool {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let url: Vec<_> = target.encode_utf16().chain(Some(0)).collect();
    // WebView2 dispatches this handler on its COM-initialized UI thread.
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            windows_sys::w!("open"),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        ) as isize
            > 32
    }
}

#[cfg(all(windows, feature = "native-ui-test"))]
pub(crate) fn ui_test_args(template: &str, e2e: &str, port: &str) -> Result<String, &'static str> {
    if e2e != "1"
        || !port.parse::<u16>().is_ok_and(|value| value >= 1024)
        || template.matches("{{CDP_PORT}}").count() != 1
    {
        return Err("Invalid isolated UI test configuration");
    }
    Ok(template.replace("{{CDP_PORT}}", port))
}

pub(crate) fn allowed_navigation(url: &tauri::Url) -> bool {
    url.path() == "/tauri.html"
        && ((url.port().is_none()
            && ((url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                || (url.scheme() == "tauri" && url.host_str() == Some("localhost"))))
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(1420)))
}

#[cfg(test)]
#[path = "../tests/unit/window.rs"]
mod tests;
