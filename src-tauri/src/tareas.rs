//! Tareas del vault: almacén JSON `.gus-tasks.json` y migración desde `tareas.md`.

use super::*;

pub(crate) const TASK_STORE_FILE: &str = ".gus-tasks.json";
pub(crate) const LEGACY_TASKS_FILE: &str = "tareas.md";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    Baja,
    Media,
    Alta,
    Urgente,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredTask {
    pub(crate) id: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    #[serde(default)]
    pub(crate) completes: bool,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) due: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) priority: Option<TaskPriority>,
    #[serde(default)]
    pub(crate) doing: bool,
    /// Tarea de la que esta es subtarea (REQ-11).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<String>,
    /// Ids de las tareas que deben completarse antes que esta.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) blocked_by: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct TaskStore {
    pub(crate) version: u32,
    pub(crate) tasks: Vec<StoredTask>,
}

impl Default for TaskStore {
    fn default() -> Self {
        Self {
            version: 1,
            tasks: Vec::new(),
        }
    }
}

pub(crate) fn vault_root(vault_path: &str) -> Result<std::path::PathBuf, String> {
    let root = std::path::PathBuf::from(expand_home(vault_path));
    if root.is_dir() {
        Ok(root)
    } else {
        Err(format!("No existe el vault «{}»", root.display()))
    }
}

pub(crate) fn task_store_path(vault_path: &str) -> Result<std::path::PathBuf, String> {
    Ok(vault_root(vault_path)?.join(TASK_STORE_FILE))
}

#[tauri::command]
pub(crate) fn load_tasks(vault_path: String) -> Result<Vec<StoredTask>, String> {
    let path = task_store_path(&vault_path)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("No se pudo leer «{}»: {err}", path.display()))?;
    let store: TaskStore = serde_json::from_str(&raw)
        .map_err(|err| format!("No se pudo leer el almacén de tareas «{}»: {err}", path.display()))?;

    Ok(store.tasks)
}

/// Comprueba las relaciones del REQ-11 antes de guardar: que los ids existan,
/// que nadie dependa de sí mismo y que ni la jerarquía ni las dependencias
/// formen ciclos. La interfaz ya lo evita; esto protege el archivo de todo lo demás.
pub(crate) fn validate_task_relations(tasks: &[StoredTask]) -> Result<(), String> {
    use std::collections::{HashMap, HashSet};

    let by_id: HashMap<&str, &StoredTask> = tasks.iter().map(|task| (task.id.as_str(), task)).collect();
    if by_id.len() != tasks.len() {
        return Err("Hay tareas con el mismo id".to_string());
    }

    for task in tasks {
        let title = &task.title;
        if let Some(parent) = &task.parent_id {
            if parent == &task.id {
                return Err(format!("«{title}» no puede ser subtarea de sí misma"));
            }
            if !by_id.contains_key(parent.as_str()) {
                return Err(format!("«{title}» cuelga de una tarea que no existe"));
            }
        }
        for blocker in &task.blocked_by {
            if blocker == &task.id {
                return Err(format!("«{title}» no puede bloquearse a sí misma"));
            }
            if !by_id.contains_key(blocker.as_str()) {
                return Err(format!("«{title}» depende de una tarea que no existe"));
            }
        }

        // Subir por los padres: si se vuelve a pasar por la misma tarea, hay ciclo.
        let mut seen = HashSet::new();
        let mut current = task.parent_id.as_deref();
        while let Some(id) = current {
            if !seen.insert(id) || id == task.id {
                return Err(format!("«{title}» forma un ciclo de subtareas"));
            }
            current = by_id[id].parent_id.as_deref();
        }
    }

    // Dependencias: búsqueda en profundidad con pila de visita (grafo dirigido).
    fn has_cycle<'a>(
        id: &'a str,
        by_id: &HashMap<&'a str, &'a StoredTask>,
        visiting: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> bool {
        if done.contains(id) {
            return false;
        }
        if !visiting.insert(id) {
            return true;
        }
        let cyclic = by_id[id]
            .blocked_by
            .iter()
            .any(|next| has_cycle(next.as_str(), by_id, visiting, done));
        visiting.remove(id);
        done.insert(id);
        cyclic
    }

    let mut done = HashSet::new();
    for task in tasks {
        if has_cycle(task.id.as_str(), &by_id, &mut HashSet::new(), &mut done) {
            return Err(format!("«{}» forma un ciclo de dependencias", task.title));
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn save_tasks(vault_path: String, tasks: Vec<StoredTask>) -> Result<(), String> {
    validate_task_relations(&tasks)?;
    let path = task_store_path(&vault_path)?;
    let store = TaskStore {
        version: 1,
        tasks,
    };
    let raw = serde_json::to_string_pretty(&store)
        .map_err(|err| format!("No se pudo serializar las tareas: {err}"))?;

    vigilancia::note_own_write(&path);
    std::fs::write(&path, raw)
        .map_err(|err| format!("No se pudo escribir «{}»: {err}", path.display()))
}

#[tauri::command]
pub(crate) fn read_legacy_tasks(vault_path: String) -> Result<Option<String>, String> {
    let path = vault_root(&vault_path)?.join(LEGACY_TASKS_FILE);
    if !path.is_file() {
        return Ok(None);
    }

    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|err| format!("No se pudo leer «{}»: {err}", path.display()))
}

#[tauri::command]
pub(crate) fn archive_legacy_tasks(vault_path: String) -> Result<bool, String> {
    let root = vault_root(&vault_path)?;
    let source = root.join(LEGACY_TASKS_FILE);
    if !source.is_file() {
        return Ok(false);
    }

    let target = unique_path(&root.join(".gus-tasks.md.bak"))?;
    std::fs::rename(&source, &target)
        .map_err(|err| format!("No se pudo archivar «{}»: {err}", source.display()))?;
    Ok(true)
}

pub(crate) const NEW_TASK_EVENT: &str = "task-created";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewTask {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
}

pub(crate) fn validate_new_task(task: NewTask) -> Result<NewTask, String> {
    let title = task.title.trim().to_string();
    if title.is_empty() {
        return Err("La tarea necesita un nombre".to_string());
    }

    let description = task
        .description
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());

    let due = task
        .due
        .map(|date| date.trim().to_string())
        .filter(|date| !date.is_empty());

    if let Some(date) = &due {
        let shape_ok = date.len() == 10
            && date.bytes().enumerate().all(|(i, byte)| {
                if i == 4 || i == 7 {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            });
        if !shape_ok {
            return Err(format!("Fecha de plazo no válida: «{date}» (usa AAAA-MM-DD)"));
        }
    }

    Ok(NewTask {
        title,
        description,
        tags: task.tags,
        due,
        priority: task.priority,
    })
}

#[tauri::command]
pub(crate) fn publish_new_task(app: AppHandle, task: NewTask) -> Result<(), String> {
    let task = validate_new_task(task)?;

    app.emit(NEW_TASK_EVENT, task)
        .map_err(|err| format!("No se pudo publicar la tarea: {err}"))?;

    Ok(())
}
