use std::collections::HashSet;

const SKIP: &[&str] = &[
    "snipclip.exe",
    "explorer.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "applicationframehost.exe",
    "runtimebroker.exe",
    "textinputhost.exe",
    "dwm.exe",
    "conhost.exe",
    "systemsettings.exe",
];

pub fn list_running_apps() -> Vec<String> {
    let mut apps: Vec<String> = unique_apps().into_iter().collect();
    apps.sort_by_key(|a| a.to_lowercase());
    apps
}

fn unique_apps() -> HashSet<String> {
    #[cfg(windows)]
    {
        win_visible::list()
    }
    #[cfg(not(windows))]
    {
        fallback_sysinfo()
    }
}

fn skip_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    SKIP.iter().any(|s| *s == lower)
}

#[cfg(not(windows))]
fn fallback_sysinfo() -> HashSet<String> {
    use sysinfo::{ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut apps = HashSet::new();
    for process in sys.processes().values() {
        let name = process.name().to_string_lossy().to_string();
        if name.is_empty() || skip_name(&name) {
            continue;
        }
        apps.insert(name);
    }
    apps
}

#[cfg(windows)]
mod win_visible {
    use super::skip_name;
    use std::collections::HashSet;
    use std::os::windows::ffi::OsStringExt;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const GW_OWNER: u32 = 4;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_APPWINDOW: isize = 0x0004_0000;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(cb: unsafe extern "system" fn(isize, isize) -> i32, lparam: isize) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn GetWindow(hwnd: isize, cmd: u32) -> isize;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn CloseHandle(handle: isize) -> i32;
        fn QueryFullProcessImageNameW(
            handle: isize,
            flags: u32,
            exe_name: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    pub fn list() -> HashSet<String> {
        let mut apps = HashSet::new();
        unsafe {
            EnumWindows(enum_cb, &mut apps as *mut HashSet<String> as isize);
        }
        apps
    }

    unsafe extern "system" fn enum_cb(hwnd: isize, lparam: isize) -> i32 {
        let apps = &mut *(lparam as *mut HashSet<String>);
        if is_user_window(hwnd) {
            if let Some(name) = exe_name(hwnd) {
                if !skip_name(&name) {
                    apps.insert(name);
                }
            }
        }
        1
    }

    fn is_user_window(hwnd: isize) -> bool {
        unsafe {
            if IsWindowVisible(hwnd) == 0 {
                return false;
            }
            if GetWindow(hwnd, GW_OWNER) != 0 {
                return false;
            }
            if GetWindowTextLengthW(hwnd) <= 0 {
                return false;
            }
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            if ex & WS_EX_TOOLWINDOW != 0 && ex & WS_EX_APPWINDOW == 0 {
                return false;
            }
            true
        }
    }

    fn exe_name(hwnd: isize) -> Option<String> {
        unsafe {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return None;
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle == 0 {
                return None;
            }
            let mut buf = [0u16; 260];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 || size == 0 {
                return None;
            }
            let path = std::ffi::OsString::from_wide(&buf[..size as usize]);
            std::path::Path::new(&path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
        }
    }
}
