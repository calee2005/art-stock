//! Art Stock native host. Protocol (keys, lock, merge) stays in `packages/core`.

#[cfg(target_os = "android")]
mod android_keystore;
mod sandbox;
mod secrets;
mod thumb;
mod watch;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct SandboxLayoutDto {
    metadata_db: String,
    cache_dir: String,
    pinned_dir: String,
}

fn sandbox_from_app(app: &tauri::AppHandle) -> Result<sandbox::SandboxPaths, String> {
    let files = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| files.join("cache"));
    let paths = sandbox::sandbox_paths(&files, &cache);
    sandbox::ensure_dirs(&paths)?;
    Ok(paths)
}

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
    let paths = sandbox_from_app(&app)?;
    Ok(paths.cache_dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn sandbox_layout(app: tauri::AppHandle) -> Result<SandboxLayoutDto, String> {
    let paths = sandbox_from_app(&app)?;
    Ok(SandboxLayoutDto {
        metadata_db: paths.metadata_db.to_string_lossy().into_owned(),
        cache_dir: paths.cache_dir.to_string_lossy().into_owned(),
        pinned_dir: paths.pinned_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn metadata_put(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let paths = sandbox_from_app(&app)?;
    sandbox::meta_put(&paths, &key, &value)
}

#[tauri::command]
fn metadata_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let paths = sandbox_from_app(&app)?;
    sandbox::meta_get(&paths, &key)
}

#[tauri::command]
fn reclaim_cache(app: tauri::AppHandle) -> Result<(), String> {
    let paths = sandbox_from_app(&app)?;
    sandbox::reclaim_cache(&paths)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(watch::WatchRegistry::new())
        .invoke_handler(tauri::generate_handler![
            secure_store_set,
            secure_store_get,
            cache_dir,
            sandbox_layout,
            metadata_put,
            metadata_get,
            reclaim_cache,
            thumb::thumb_generate,
            watch::watch_start,
            watch::watch_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Art Stock");
}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_compiles() {}
}
