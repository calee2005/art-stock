//! Pad share inbox under `filesDir/inbox`. Protocol writes stay in TypeScript `importAsset`.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct InboxItemDto {
    pub name: String,
    pub size: u64,
    #[serde(rename = "mimeGuess")]
    pub mime_guess: String,
}

pub fn sanitize_inbox_name(name: &str) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid inbox name".into());
    }
    let base = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid inbox name".to_string())?;
    if base.is_empty() || base.len() > 128 {
        return Err("invalid inbox name".into());
    }
    if !base
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("invalid inbox name".into());
    }
    Ok(base.to_string())
}

fn mime_guess(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".webp") {
        "image/webp".into()
    } else if lower.ends_with(".pdf") {
        "application/pdf".into()
    } else {
        "application/octet-stream".into()
    }
}

fn inbox_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        Ok(crate::android_jni::files_dir()?.join("inbox"))
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("inbox is Android-only".into())
    }
}

fn files_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        crate::android_jni::files_dir()
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("inbox is Android-only".into())
    }
}

fn assert_no_secret_material(raw: &str) -> Result<(), String> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("secretaccesskey") || lower.contains("super-secret") {
        return Err("inbox scan state must not contain secrets".into());
    }
    Ok(())
}

#[tauri::command]
pub fn inbox_list() -> Result<Vec<InboxItemDto>, String> {
    let dir = inbox_dir()?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(safe) = sanitize_inbox_name(&name) else {
            continue;
        };
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        items.push(InboxItemDto {
            name: safe,
            size,
            mime_guess: mime_guess(&name),
        });
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
pub fn inbox_read(name: String) -> Result<Vec<u8>, String> {
    let safe = sanitize_inbox_name(&name)?;
    let path = inbox_dir()?.join(safe);
    fs::read(path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn inbox_remove(name: String) -> Result<(), String> {
    let safe = sanitize_inbox_name(&name)?;
    let path = inbox_dir()?.join(safe);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn inbox_scan_load() -> Result<Option<serde_json::Value>, String> {
    let path = files_root()?.join("inbox-scan.json");
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    assert_no_secret_material(&raw)?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| err.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
pub fn inbox_scan_save(state: serde_json::Value) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(&state).map_err(|err| err.to_string())?;
    assert_no_secret_material(&raw)?;
    let path = files_root()?.join("inbox-scan.json");
    fs::write(path, raw).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::{assert_no_secret_material, sanitize_inbox_name};

    #[test]
    fn rejects_traversal() {
        assert!(sanitize_inbox_name("../secret.png").is_err());
        assert!(sanitize_inbox_name("ok-share.png").is_ok());
    }

    #[test]
    fn scan_state_rejects_secrets() {
        assert!(assert_no_secret_material(r#"{"objectIds":{"a.png":"obj-1"}}"#).is_ok());
        assert!(assert_no_secret_material(r#"{"secretAccessKey":"x"}"#).is_err());
    }
}
