//! Poll local files and emit `watch-change` to the webview.
//! Protocol (lock, snapshot) stays in packages/core; Rust only reports paths.

use std::collections::HashMap;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};

pub struct WatchRegistry {
    stops: Mutex<HashMap<String, mpsc::Sender<()>>>,
}

impl WatchRegistry {
    pub fn new() -> Self {
        Self {
            stops: Mutex::new(HashMap::new()),
        }
    }
}

fn modified_at(path: &str) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).ok().and_then(|meta| meta.modified().ok())
}

#[tauri::command]
pub fn watch_start(app: AppHandle, state: State<WatchRegistry>, path: String) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    {
        let mut map = state.stops.lock().map_err(|err| err.to_string())?;
        if let Some(previous) = map.insert(path.clone(), tx) {
            let _ = previous.send(());
        }
    }
    let watched = path.clone();
    thread::spawn(move || {
        let mut last = modified_at(&watched);
        loop {
            match rx.recv_timeout(Duration::from_millis(400)) {
                Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(mtime) = modified_at(&watched) {
                        if last.map(|prev| mtime > prev).unwrap_or(true) {
                            last = Some(mtime);
                            let _ = app.emit("watch-change", &watched);
                        }
                    }
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn watch_stop(state: State<WatchRegistry>, path: String) -> Result<(), String> {
    let mut map = state.stops.lock().map_err(|err| err.to_string())?;
    if let Some(tx) = map.remove(&path) {
        let _ = tx.send(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn modified_at_missing_path_is_none() {
        assert!(super::modified_at("/no/such/art-stock-watch-path").is_none());
    }
}
