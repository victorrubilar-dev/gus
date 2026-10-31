//! Vigilancia del vault (REQ-13): avisa a la interfaz de lo que cambia fuera de la app.

use super::*;
use notify_debouncer_mini::notify::{self, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) const VAULT_EVENT: &str = "vault-changed";

/// Agrupa ráfagas de eventos (un editor externo suele escribir varias veces).
const DEBOUNCE: Duration = Duration::from_millis(400);
/// Aunque los eventos no cesen, se avisa al menos con este intervalo.
const MAX_WAIT: Duration = Duration::from_secs(2);
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
pub(crate) struct VaultWatcher(Mutex<Option<RecommendedWatcher>>);

/// Vigila `vault` y llama a `on_change` con las rutas que cambiaron fuera de la
/// app, agrupadas y sin el ruido ni las escrituras propias. El vigilante vive
/// mientras viva lo que devuelve.
///
/// Los eventos de **acceso** (abrir o leer un archivo, listar una carpeta) se
/// descartan: la propia app lee el vault en cada recarga —lista del explorador,
/// grafo de enlaces— y, contándolos, cada lectura provocaba otra recarga en un
/// bucle sin fin (el explorador parpadeando, el grafo recolocándose sin parar).
fn start_watcher(
    vault: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> Result<RecommendedWatcher, notify::Error> {
    let (tx, rx) = std::sync::mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        for path in event.paths {
            let _ = tx.send(path);
        }
    })?;
    watcher.watch(vault, RecursiveMode::Recursive)?;

    let root = vault.to_path_buf();
    // El hilo termina solo: al soltar el vigilante se suelta `tx` y `recv` falla.
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let started = Instant::now();
            let mut paths = vec![first];
            while started.elapsed() < MAX_WAIT {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(path) => paths.push(path),
                    Err(_) => break,
                }
            }

            paths.sort();
            paths.dedup();
            let changed: Vec<String> = paths
                .iter()
                .filter(|path| !is_noise(&root, path) && !is_own_write(path))
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            if !changed.is_empty() {
                on_change(changed);
            }
        }
    });

    Ok(watcher)
}

#[tauri::command]
pub(crate) fn watch_vault(
    app: AppHandle,
    state: tauri::State<'_, VaultWatcher>,
    path: String,
) -> Result<(), String> {
    let vault = PathBuf::from(expand_home(&path));

    let watcher = start_watcher(&vault, move |changed| {
        let _ = app.emit(VAULT_EVENT, changed);
    })
    .map_err(|err| format!("No se pudo vigilar «{}»: {err}", vault.display()))?;

    // Sustituir el watcher anterior lo suelta y, con él, su vigilancia.
    *state.0.lock().map_err(|_| "Vigilancia bloqueada".to_string())? = Some(watcher);
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

    #[test]
    fn leer_o_listar_no_avisa_pero_escribir_si() {
        let dir = std::env::temp_dir().join(format!("gus-vigilancia-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("carpeta");
        std::fs::write(dir.join("a.md"), "hola").expect("nota");

        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = start_watcher(&dir, move |changed| {
            let _ = tx.send(changed);
        })
        .expect("vigilar");
        std::thread::sleep(Duration::from_millis(300));

        // La app lee y lista el vault en cada recarga: eso no es un cambio.
        let _ = std::fs::read_to_string(dir.join("a.md")).expect("leer");
        let _ = std::fs::read_dir(&dir).expect("listar").count();
        assert!(
            rx.recv_timeout(Duration::from_millis(1200)).is_err(),
            "leer no debe avisar"
        );

        // Escribir sí lo es.
        std::fs::write(dir.join("a.md"), "otra cosa").expect("escribir");
        let changed = rx.recv_timeout(Duration::from_secs(3)).expect("escribir debe avisar");
        assert!(changed.iter().any(|path| path.ends_with("a.md")));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
