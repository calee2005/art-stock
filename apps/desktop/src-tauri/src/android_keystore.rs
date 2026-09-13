//! JNI bridge to [app.artstock.desktop.KeystoreSecrets].
//! Plaintext credentials never go to SharedPreferences; the AES key stays in Android Keystore.

use jni::objects::{JObject, JString, JValue};
use jni::JavaVM;

fn check_exception(env: &mut jni::JNIEnv<'_>) -> Result<(), String> {
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return Err("Android Keystore JNI exception".into());
    }
    Ok(())
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|err| err.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|err| err.to_string())?;
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    let class = env
        .find_class("app/artstock/desktop/KeystoreSecrets")
        .map_err(|err| err.to_string())?;
    let jkey = env.new_string(key).map_err(|err| err.to_string())?;
    let jval = env.new_string(value).map_err(|err| err.to_string())?;
    env.call_static_method(
        class,
        "set",
        "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V",
        &[
            JValue::Object(&context),
            JValue::Object(&jkey),
            JValue::Object(&jval),
        ],
    )
    .map_err(|err| err.to_string())?;
    check_exception(&mut env)
}

pub fn get(key: &str) -> Result<Option<String>, String> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|err| err.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|err| err.to_string())?;
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    let class = env
        .find_class("app/artstock/desktop/KeystoreSecrets")
        .map_err(|err| err.to_string())?;
    let jkey = env.new_string(key).map_err(|err| err.to_string())?;
    let result = env
        .call_static_method(
            class,
            "get",
            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(&context), JValue::Object(&jkey)],
        )
        .map_err(|err| err.to_string())?;
    check_exception(&mut env)?;
    let obj = result.l().map_err(|err| err.to_string())?;
    if obj.is_null() {
        return Ok(None);
    }
    let jstring = JString::from(obj);
    let rust = env
        .get_string(&jstring)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .into_owned();
    Ok(Some(rust))
}
