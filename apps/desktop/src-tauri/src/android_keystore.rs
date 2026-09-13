//! JNI bridge to [app.artstock.desktop.KeystoreSecrets].
//! Plaintext credentials never go to SharedPreferences; the AES key stays in Android Keystore.

use jni::objects::{JString, JValue};

pub fn set(key: &str, value: &str) -> Result<(), String> {
    crate::android_jni::with_jni(|env, handles| {
        let jkey = env.new_string(key).map_err(|err| err.to_string())?;
        let jval = env.new_string(value).map_err(|err| err.to_string())?;
        env.call_static_method(
            handles.keystore,
            "set",
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
                handles.keystore,
                "get",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(handles.context), JValue::Object(&jkey)],
            )
            .map_err(|err| err.to_string())?;
        crate::android_jni::check_exception(env)?;
        let obj = result.l().map_err(|err| err.to_string())?;
        if obj.is_null() {
            return Ok(None);
        }
        let rust = env
            .get_string(&JString::from(obj))
            .map_err(|err| err.to_string())?
            .to_string_lossy()
            .into_owned();
        Ok(Some(rust))
    })
}
