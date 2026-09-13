//! Debug/Pad e2e helpers. Files must never contain secretAccessKey.

use serde_json::Value;
use std::fs;
use tauri::Manager;

fn assert_no_secret_material(raw: &str) -> Result<(), String> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("secretaccesskey") || lower.contains("super-secret") {
        return Err("pad-e2e file must not contain secrets".into());
    }
    Ok(())
}

fn app_file(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
pub fn pad_e2e_config(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = app_file(&app, "pad-e2e.json")?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    assert_no_secret_material(&raw)?;
    let value: Value = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
pub fn pad_e2e_report(app: tauri::AppHandle, status: Value) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(&status).map_err(|err| err.to_string())?;
    assert_no_secret_material(&raw)?;
    let path = app_file(&app, "pad-e2e-status.json")?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::assert_no_secret_material;

    #[test]
    fn rejects_secret_material() {
        assert!(assert_no_secret_material(r#"{"endpoint":"http://127.0.0.1"}"#).is_ok());
        assert!(assert_no_secret_material(r#"{"secretAccessKey":"x"}"#).is_err());
    }
}
