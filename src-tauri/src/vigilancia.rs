//! Vigilancia del vault (REQ-13): avisa a la interfaz de lo que cambia fuera de la app.

use super::*;
use notify_debouncer_mini::{new_debouncer, notify::RecommendedWatcher, notify::RecursiveMode, Debouncer};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) const VAULT_EVENT: &str = "vault-changed";

/// Agrupa ráfagas de eventos (un editor externo suele escribir varias veces).
const DEBOUNCE: Duration = Duration::from_millis(400);
/// Lo que la app acaba de escribir ella misma no es un cambio externo.
const OWN_WRITE_TTL: Duration = Duration::from_secs(3);
/// Lo único oculto que sí interesa: lo edita otra herramienta o dispositivo.
const WATCHED_HIDDEN: &str = ".gus-tasks.json";

static OWN_WRITES: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());

/// Anota una escritura propia para que el watcher no la reenvíe a la interfaz.
pub(crate) fn note_own_write(path: &Path) {
    if let Ok(mut writes) = OWN_WRITES.lock() {
        writes.retain(|(_, at)| at.elapsed() < OWN_WRITE_TTL);
        writes.push((path.to_path_buf(), Instant::now()));
    }
}

fn is_own_write(path: &Path) -> bool {
    OWN_WRITES.lock().is_ok_and(|writes| {
        writes
            .iter()
            .any(|(own, at)| own == path && at.elapsed() < OWN_WRITE_TTL)
    })
}

/// Carpetas y archivos ocultos (`.gus-index`, `.gus-trash`, `.git`…) son ruido,
/// salvo el almacén de tareas.
fn is_noise(vault: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(vault).unwrap_or(path);
    relative.components().any(|part| {
        let name = part.as_os_str().to_string_lossy();
        name.starts_with('.') && name != WATCHED_HIDDEN
    })
}

#[derive(Default)]
pub(crate) struct VaultWatcher(Mutex<Option<Debouncer<RecommendedWatcher>>>);

#[tauri::command]
pub(crate) fn watch_vault(
    app: AppHandle,
    state: tauri::State<'_, VaultWatcher>,
    path: String,
) -> Result<(), String> {
    let vault = PathBuf::from(expand_home(&path));
    let root = vault.clone();

    let mut debouncer = new_debouncer(DEBOUNCE, move |result: notify_debouncer_mini::DebounceEventResult| {
        let Ok(events) = result else { return };
        let changed: Vec<String> = events
            .iter()
            .map(|event| &event.path)
            .filter(|path| !is_noise(&root, path) && !is_own_write(path))
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        if !changed.is_empty() {
            let _ = app.emit(VAULT_EVENT, changed);
        }
    })
    .map_err(|err| format!("No se pudo vigilar «{}»: {err}", vault.display()))?;

    debouncer
        .watcher()
        .watch(&vault, RecursiveMode::Recursive)
        .map_err(|err| format!("No se pudo vigilar «{}»: {err}", vault.display()))?;

    // Sustituir el watcher anterior lo suelta y, con él, su vigilancia.
    *state.0.lock().map_err(|_| "Vigilancia bloqueada".to_string())? = Some(debouncer);
    Ok(())
}

#[tauri::command]
pub(crate) fn unwatch_vault(state: tauri::State<'_, VaultWatcher>) {
    if let Ok(mut watcher) = state.0.lock() {
        *watcher = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ruido_son_las_carpetas_ocultas_menos_las_tareas() {
        let vault = Path::new("/v");
        assert!(is_noise(vault, Path::new("/v/.gus-index/idx.json")));
        assert!(is_noise(vault, Path::new("/v/.git/HEAD")));
        assert!(is_noise(vault, Path::new("/v/a/.nota.md.swp")));
        assert!(!is_noise(vault, Path::new("/v/a/nota.md")));
        assert!(!is_noise(vault, Path::new("/v/.gus-tasks.json")));
    }

    #[test]
    fn la_escritura_propia_se_reconoce() {
        let path = Path::new("/v/propia-test.md");
        assert!(!is_own_write(path));
        note_own_write(path);
        assert!(is_own_write(path));
    }
}
