use std::fs;
use std::path::{Path, PathBuf};

#[cfg(not(target_os = "android"))]
use rusqlite::Connection;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxPaths {
    pub metadata_db: PathBuf,
    pub cache_dir: PathBuf,
    pub pinned_dir: PathBuf,
}

/// `files_root` is durable app sandbox; `cache_root` is OS-reclaimable.
pub fn sandbox_paths(files_root: &Path, cache_root: &Path) -> SandboxPaths {
    SandboxPaths {
        metadata_db: files_root.join("metadata.sqlite"),
        cache_dir: cache_root.join("blobs"),
        pinned_dir: files_root.join("pinned"),
    }
}

pub fn ensure_dirs(paths: &SandboxPaths) -> Result<(), String> {
    fs::create_dir_all(&paths.cache_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&paths.pinned_dir).map_err(|err| err.to_string())?;
    if let Some(parent) = paths.metadata_db.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn reclaim_cache(paths: &SandboxPaths) -> Result<(), String> {
    if paths.cache_dir.exists() {
        fs::remove_dir_all(&paths.cache_dir).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&paths.cache_dir).map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn meta_put(paths: &SandboxPaths, key: &str, value: &str) -> Result<(), String> {
    if key.is_empty() || key.contains("secretAccessKey") {
        return Err("invalid meta key".into());
    }
    ensure_dirs(paths)?;
    let conn = Connection::open(&paths.metadata_db).map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
        [],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)",
        [key, value],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn meta_get(paths: &SandboxPaths, key: &str) -> Result<Option<String>, String> {
    ensure_dirs(paths)?;
    let conn = Connection::open(&paths.metadata_db).map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
        [],
    )
    .map_err(|err| err.to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM meta WHERE key = ?1")
        .map_err(|err| err.to_string())?;
    let mut rows = stmt.query([key]).map_err(|err| err.to_string())?;
    match rows.next().map_err(|err| err.to_string())? {
        Some(row) => Ok(Some(row.get(0).map_err(|err| err.to_string())?)),
        None => Ok(None),
    }
}

#[cfg(target_os = "android")]
pub fn meta_put(_paths: &SandboxPaths, key: &str, value: &str) -> Result<(), String> {
    android_sandbox::put(key, value)
}

#[cfg(target_os = "android")]
pub fn meta_get(_paths: &SandboxPaths, key: &str) -> Result<Option<String>, String> {
    android_sandbox::get(key)
}

#[cfg(target_os = "android")]
mod android_sandbox {
    use jni::objects::{JString, JValue};

    pub fn put(key: &str, value: &str) -> Result<(), String> {
        crate::android_jni::with_jni(|env, handles| {
            let jkey = env.new_string(key).map_err(|err| err.to_string())?;
            let jval = env.new_string(value).map_err(|err| err.to_string())?;
            env.call_static_method(
                handles.sandbox,
                "putMeta",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    JValue::Object(handles.context),
                    JValue::Object(&jkey),
                    JValue::Object(&jval),
                ],
            )
            .map_err(|err| err.to_string())?;
            crate::android_jni::check_exception(env)
        })
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        crate::android_jni::with_jni(|env, handles| {
            let jkey = env.new_string(key).map_err(|err| err.to_string())?;
            let result = env
                .call_static_method(
                    handles.sandbox,
                    "getMeta",
                    "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                    &[JValue::Object(handles.context), JValue::Object(&jkey)],
                )
                .map_err(|err| err.to_string())?;
            crate::android_jni::check_exception(env)?;
            let obj = result.l().map_err(|err| err.to_string())?;
            if obj.is_null() {
                return Ok(None);
            }
            let text = env
                .get_string(&JString::from(obj))
                .map_err(|err| err.to_string())?
                .to_string_lossy()
                .into_owned();
            Ok(Some(text))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_roots() -> (PathBuf, PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!("art-stock-sandbox-{nanos}"));
        (base.join("files"), base.join("cache"))
    }

    #[test]
    fn metadata_sqlite_and_reclaim_leaves_pinned() {
        let (files, cache) = temp_roots();
        let paths = sandbox_paths(&files, &cache);
        ensure_dirs(&paths).unwrap();
        meta_put(&paths, "libraryCount", "3").unwrap();
        assert_eq!(meta_get(&paths, "libraryCount").unwrap().as_deref(), Some("3"));
        assert!(paths.metadata_db.exists());
        let db_bytes = fs::read(&paths.metadata_db).unwrap();
        assert!(!db_bytes.windows(b"secretAccessKey".len()).any(|w| w == b"secretAccessKey"));

        fs::write(paths.cache_dir.join("thumb.bin"), [1_u8, 2, 3]).unwrap();
        fs::write(paths.pinned_dir.join("original.bin"), [9_u8, 9, 9]).unwrap();
        assert_ne!(paths.cache_dir, paths.pinned_dir);
        reclaim_cache(&paths).unwrap();
        assert!(!paths.cache_dir.join("thumb.bin").exists());
        assert!(paths.pinned_dir.join("original.bin").exists());
        assert_eq!(meta_get(&paths, "libraryCount").unwrap().as_deref(), Some("3"));
        let _ = fs::remove_dir_all(files.parent().unwrap());
    }
}
