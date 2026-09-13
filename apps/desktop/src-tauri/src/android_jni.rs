//! Process-level JavaVM + Application context for Pad JNI.
//!
//! wry never calls `ndk_context::initialize_android_context`. Looking up
//! `ndk_context::android_context()` panics and kills the Pad process. Kotlin
//! `KeystoreSecrets.nativeAttach` stores VM + context instead.
//!
//! Class objects are cached here: `FindClass` on a newly attached IPC thread
//! uses the system class loader and cannot see `app.artstock.desktop.*`.

use jni::objects::{JClass, JObject};
use jni::{JNIEnv, JavaVM};
use std::sync::Mutex;

struct AndroidJni {
    vm: JavaVM,
    context: jni::objects::GlobalRef,
    keystore: jni::objects::GlobalRef,
    sandbox: jni::objects::GlobalRef,
}

static ANDROID_JNI: Mutex<Option<AndroidJni>> = Mutex::new(None);

pub(crate) struct JniHandles<'a> {
    pub context: &'a JObject<'a>,
    pub keystore: &'a JClass<'a>,
    pub sandbox: &'a JClass<'a>,
}

pub(crate) fn check_exception(env: &mut JNIEnv<'_>) -> Result<(), String> {
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return Err("Android JNI exception".into());
    }
    Ok(())
}

pub(crate) fn with_jni<T>(
    f: impl FnOnce(&mut JNIEnv<'_>, JniHandles<'_>) -> Result<T, String>,
) -> Result<T, String> {
    let guard = ANDROID_JNI
        .lock()
        .map_err(|_| "Android JNI lock poisoned".to_string())?;
    let jni = guard
        .as_ref()
        .ok_or_else(|| "Android JNI context not attached".to_string())?;
    let mut env = jni
        .vm
        .attach_current_thread()
        .map_err(|err| err.to_string())?;
    let context = jni.context.as_obj();
    let keystore_obj = jni.keystore.as_obj();
    let sandbox_obj = jni.sandbox.as_obj();
    let keystore: &JClass = <&JClass>::from(keystore_obj);
    let sandbox: &JClass = <&JClass>::from(sandbox_obj);
    let handles = JniHandles {
        context,
        keystore,
        sandbox,
    };
    f(&mut env, handles)
}

fn attach_from_jni(env: &mut JNIEnv, context: JObject) -> Result<(), String> {
    let vm = env.get_java_vm().map_err(|err| err.to_string())?;
    let global_ctx = env
        .new_global_ref(&context)
        .map_err(|err| err.to_string())?;
    let keystore = env
        .find_class("app/artstock/desktop/KeystoreSecrets")
        .map_err(|err| err.to_string())?;
    let sandbox = env
        .find_class("app/artstock/desktop/SandboxStore")
        .map_err(|err| err.to_string())?;
    check_exception(env)?;
    let keystore = env
        .new_global_ref(&keystore)
        .map_err(|err| err.to_string())?;
    let sandbox = env
        .new_global_ref(&sandbox)
        .map_err(|err| err.to_string())?;
    let mut slot = ANDROID_JNI
        .lock()
        .map_err(|_| "Android JNI lock poisoned".to_string())?;
    *slot = Some(AndroidJni {
        vm,
        context: global_ctx,
        keystore,
        sandbox,
    });
    Ok(())
}

/// Called from `KeystoreSecrets.nativeAttach` in `MainActivity.onCreate`.
#[no_mangle]
#[allow(non_snake_case)]
pub extern "system" fn Java_app_artstock_desktop_KeystoreSecrets_nativeAttach<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    context: JObject<'local>,
) {
    if let Err(err) = attach_from_jni(&mut env, context) {
        let _ = env.throw_new("java/lang/IllegalStateException", err);
    }
}
