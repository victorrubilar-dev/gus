//! Hábitos (REQ-04): definición y registro diario en `.gus-habits.json`.

use super::*;
use std::collections::{HashMap, HashSet};

pub(crate) const HABITS_FILE: &str = ".gus-habits.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Habit {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    /// Días en que toca, de 0 (lunes) a 6 (domingo).
    #[serde(default)]
    pub(crate) days: Vec<u8>,
    /// Día de alta `AAAA-MM-DD`: antes de él el hábito no cuenta como fallado.
    pub(crate) created: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub(crate) struct HabitStore {
    #[serde(default)]
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) habits: Vec<Habit>,
    /// Id del hábito → días `AAAA-MM-DD` en que se hizo.
    #[serde(default)]
    pub(crate) log: HashMap<String, Vec<String>>,
}

fn is_iso_day(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| match i {
            4 | 7 => *b == b'-',
            _ => b.is_ascii_digit(),
        })
}

/// Rechaza lo que la interfaz nunca produce: ids repetidos, días fuera de
/// 0..=6, fechas mal formadas o registros de hábitos que no existen.
pub(crate) fn validate_habits(store: &HabitStore) -> Result<(), String> {
    let mut ids = HashSet::new();
    for habit in &store.habits {
        if !ids.insert(habit.id.as_str()) {
            return Err(format!("Hay hábitos con el mismo id: «{}»", habit.id));
        }
        if habit.name.trim().is_empty() {
            return Err("Un hábito no puede quedarse sin nombre".to_string());
        }
        if habit.days.iter().any(|day| *day > 6) {
            return Err(format!("«{}» tiene un día de la semana fuera de rango", habit.name));
        }
        if !is_iso_day(&habit.created) {
            return Err(format!("«{}» tiene una fecha de alta no válida", habit.name));
        }
    }
    for (id, days) in &store.log {
        if !ids.contains(id.as_str()) {
            return Err(format!("El registro habla de un hábito que no existe: «{id}»"));
        }
        if let Some(bad) = days.iter().find(|day| !is_iso_day(day)) {
            return Err(format!("Fecha de registro no válida: «{bad}»"));
        }
    }
    Ok(())
}

fn habits_path(vault_path: &str) -> Result<std::path::PathBuf, String> {
    Ok(tareas::vault_root(vault_path)?.join(HABITS_FILE))
}

#[tauri::command]
pub(crate) fn load_habits(vault_path: String) -> Result<HabitStore, String> {
    let path = habits_path(&vault_path)?;
    if !path.exists() {
        return Ok(HabitStore::default());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("No se pudo leer «{}»: {err}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("No se pudo leer los hábitos «{}»: {err}", path.display()))
}

#[tauri::command]
pub(crate) fn save_habits(vault_path: String, store: HabitStore) -> Result<(), String> {
    validate_habits(&store)?;
    let path = habits_path(&vault_path)?;
    let store = HabitStore { version: 1, ..store };
    let raw = serde_json::to_string_pretty(&store)
        .map_err(|err| format!("No se pudo serializar los hábitos: {err}"))?;

    vigilancia::note_own_write(&path);
    std::fs::write(&path, raw)
        .map_err(|err| format!("No se pudo escribir «{}»: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn habit(id: &str) -> Habit {
        Habit {
            id: id.into(),
            name: format!("Hábito {id}"),
            description: None,
            days: vec![0, 2, 4],
            created: "2026-10-01".into(),
        }
    }

    fn store(habits: Vec<Habit>, log: &[(&str, &[&str])]) -> HabitStore {
        HabitStore {
            version: 0,
            habits,
            log: log
                .iter()
                .map(|(id, days)| (id.to_string(), days.iter().map(|d| d.to_string()).collect()))
                .collect(),
        }
    }

    #[test]
    fn los_habitos_validos_se_guardan_y_se_leen() {
        let dir = std::env::temp_dir().join(format!("gus-habitos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("vault");
        let vault = dir.to_string_lossy().into_owned();

        assert_eq!(load_habits(vault.clone()).expect("vacío"), HabitStore::default());

        let datos = store(vec![habit("a")], &[("a", &["2026-10-02", "2026-10-04"])]);
        save_habits(vault.clone(), datos.clone()).expect("guardar");
        let leidos = load_habits(vault).expect("leer");
        assert_eq!(leidos.habits, datos.habits);
        assert_eq!(leidos.log, datos.log);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lo_invalido_se_rechaza() {
        let mut sin_nombre = habit("a");
        sin_nombre.name = "  ".into();
        let mut dia_raro = habit("a");
        dia_raro.days = vec![7];
        let mut fecha_mala = habit("a");
        fecha_mala.created = "ayer".into();

        let casos = [
            store(vec![habit("a"), habit("a")], &[]),
            store(vec![sin_nombre], &[]),
            store(vec![dia_raro], &[]),
            store(vec![fecha_mala], &[]),
            store(vec![habit("a")], &[("fantasma", &["2026-10-02"])]),
            store(vec![habit("a")], &[("a", &["2026-13"])]),
        ];
        for caso in casos {
            assert!(validate_habits(&caso).is_err(), "{caso:?}");
        }
    }
}
