use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

fn sanitize_key(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 128 {
        return Err("secret key length invalid".into());
    }
    if !key
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("secret key must be [A-Za-z0-9._-]".into());
    }
    if key.contains("..") {
        return Err("secret key must not contain ..".into());
    }
    Ok(key.to_string())
}

pub fn secrets_dir(app_data: &Path) -> PathBuf {
    app_data.join("secrets")
}

pub fn cache_dir(app_data: &Path) -> PathBuf {
    app_data.join("cache")
}

pub fn set_secret(app_data: &Path, key: &str, value: &str) -> Result<(), String> {
    let key = sanitize_key(key)?;
    let dir = secrets_dir(app_data);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(key);
    let mut file = fs::File::create(&path).map_err(|err| err.to_string())?;
    file.write_all(value.as_bytes())
        .map_err(|err| err.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn get_secret(app_data: &Path, key: &str) -> Result<Option<String>, String> {
    let key = sanitize_key(key)?;
    let path = secrets_dir(app_data).join(key);
    match fs::read_to_string(path) {
        Ok(body) => Ok(Some(body)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_data() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("art-stock-secrets-{nanos}"))
    }

    #[test]
    fn secrets_are_not_stored_as_json_config() {
        let root = temp_app_data();
        set_secret(&root, "secretAccessKey", "super-secret").unwrap();
        assert_eq!(
            get_secret(&root, "secretAccessKey").unwrap().as_deref(),
            Some("super-secret")
        );
        let json_config = root.join("config.json");
        assert!(!json_config.exists());
        let secret_path = secrets_dir(&root).join("secretAccessKey");
        assert!(secret_path.exists());
        assert!(!secret_path.extension().is_some_and(|ext| ext == "json"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&secret_path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cache_dir_is_under_app_data() {
        let root = PathBuf::from("/tmp/art-stock-app");
        assert_eq!(cache_dir(&root), root.join("cache"));
    }
}
