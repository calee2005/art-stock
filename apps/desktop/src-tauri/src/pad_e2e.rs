//! Debug/Pad e2e helpers. Files must never contain secretAccessKey.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn assert_no_secret_material(raw: &str) -> Result<(), String> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("secretaccesskey") || lower.contains("super-secret") {
        return Err("pad-e2e file must not contain secrets".into());
    }
    Ok(())
}

/// Android `app_data_dir` is `Context.getDataDir()` (parent of `filesDir`).
/// PadE2eStore and `adb run-as … files/` write under `filesDir`.
pub fn resolve_e2e_dir(data_dir: &Path) -> PathBuf {
    let files = data_dir.join("files");
    if files.is_dir() {
        files
    } else {
        data_dir.to_path_buf()
    }
}

fn app_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = {
        #[cfg(target_os = "android")]
        {
            crate::android_jni::files_dir().or_else(|_| {
                app.path()
                    .app_data_dir()
                    .map(|data| resolve_e2e_dir(&data))
                    .map_err(|err| err.to_string())
            })?
        }
        #[cfg(not(target_os = "android"))]
        {
            let data = app.path().app_data_dir().map_err(|err| err.to_string())?;
            resolve_e2e_dir(&data)
        }
    };
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
pub fn pad_e2e_config(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    read_e2e_json(&app, "pad-e2e.json")
}

#[tauri::command]
pub fn pad_e2e_report(app: tauri::AppHandle, status: Value) -> Result<(), String> {
    write_e2e_json(&app, "pad-e2e-status.json", status)
}

fn read_e2e_json(app: &tauri::AppHandle, name: &str) -> Result<Option<Value>, String> {
    let path = app_file(app, name)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    assert_no_secret_material(&raw)?;
    let value: Value = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
    Ok(Some(value))
}

fn write_e2e_json(app: &tauri::AppHandle, name: &str, status: Value) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(&status).map_err(|err| err.to_string())?;
    assert_no_secret_material(&raw)?;
    let path = app_file(app, name)?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn pad_share_e2e_config(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    read_e2e_json(&app, "pad-share-e2e.json")
}

#[tauri::command]
pub fn pad_share_e2e_report(app: tauri::AppHandle, status: Value) -> Result<(), String> {
    write_e2e_json(&app, "pad-share-e2e-status.json", status)
}

#[cfg(test)]
mod tests {
    use super::{assert_no_secret_material, resolve_e2e_dir};
    use std::fs;

    #[test]
    fn rejects_secret_material() {
        assert!(assert_no_secret_material(r#"{"endpoint":"http://127.0.0.1"}"#).is_ok());
        assert!(assert_no_secret_material(r#"{"secretAccessKey":"x"}"#).is_err());
    }

    #[test]
    fn prefers_files_subdir_when_present() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("art-stock-e2e-{nanos}"));
        let files = root.join("files");
        fs::create_dir_all(&files).unwrap();
        assert_eq!(resolve_e2e_dir(&root), files);
        assert_eq!(resolve_e2e_dir(&files), files);
        let _ = fs::remove_dir_all(root);
    }
}
