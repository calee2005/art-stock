//! Art Stock native host. Protocol (keys, lock, merge) stays in `packages/core`.

mod secrets;

use tauri::Manager;

#[tauri::command]
fn secure_store_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    secrets::set_secret(&dir, &key, &value)
}

#[tauri::command]
fn secure_store_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    secrets::get_secret(&dir, &key)
}

#[tauri::command]
fn cache_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let cache = secrets::cache_dir(&dir);
    std::fs::create_dir_all(&cache).map_err(|err| err.to_string())?;
    Ok(cache.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secure_store_set,
            secure_store_get,
            cache_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running Art Stock");
}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_compiles() {}
}
