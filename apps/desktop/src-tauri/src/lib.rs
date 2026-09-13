//! Art Stock native host. Protocol (keys, lock, merge) stays in `packages/core`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Art Stock");
}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_compiles() {}
}
