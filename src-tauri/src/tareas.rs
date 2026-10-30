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

#[tauri::command]
pub(crate) fn save_tasks(vault_path: String, tasks: Vec<StoredTask>) -> Result<(), String> {
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
