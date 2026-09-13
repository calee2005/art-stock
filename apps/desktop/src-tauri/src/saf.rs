//! Android SAF export-folder grant. Protocol writes stay in TypeScript.

use serde_json::{json, Value};

fn assert_no_secret_material(raw: &str) -> Result<(), String> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("secretaccesskey") || lower.contains("super-secret") {
        return Err("saf payload must not contain secrets".into());
    }
    Ok(())
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn parse_json(raw: String) -> Result<Value, String> {
    assert_no_secret_material(&raw)?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn saf_status() -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        parse_json(crate::android_jni::saf_call(
            "statusJson",
            "(Landroid/content/Context;)Ljava/lang/String;",
        )?)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(json!({ "authorized": false, "label": "" }))
    }
}

#[tauri::command]
pub fn saf_scan() -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        parse_json(crate::android_jni::saf_call(
            "scanJson",
            "(Landroid/content/Context;)Ljava/lang/String;",
        )?)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(json!({ "authorized": false, "copied": 0 }))
    }
}

#[tauri::command]
pub fn saf_revoke() -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let _ = crate::android_jni::saf_call("revoke", "(Landroid/content/Context;)V")?;
    }
    Ok(json!({ "authorized": false }))
}

#[tauri::command]
pub fn saf_open_picker() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = crate::android_jni::saf_call("openPicker", "(Landroid/content/Context;)V")?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("SAF picker is Android-only".into())
    }
}

#[tauri::command]
pub fn saf_grant_e2e() -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        parse_json(crate::android_jni::saf_call(
            "grantLocalDirForE2e",
            "(Landroid/content/Context;)Ljava/lang/String;",
        )?)
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("SAF e2e is Android-only".into())
    }
}

#[tauri::command]
pub fn saf_constraints() -> Result<Value, String> {
    Ok(json!({
        "charging": true,
        "unmeteredWifi": true,
        "minIntervalMinutes": 15,
        "writesRemote": false,
        "holdsLock": false
    }))
}

#[cfg(test)]
mod tests {
    use super::assert_no_secret_material;

    #[test]
    fn rejects_secrets() {
        assert!(assert_no_secret_material(r#"{"authorized":true}"#).is_ok());
        assert!(assert_no_secret_material(r#"{"secretAccessKey":"x"}"#).is_err());
    }
}
