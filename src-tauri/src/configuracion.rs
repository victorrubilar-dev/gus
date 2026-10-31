//! Configuración de la app: vaults conocidos, ajustes y el fichero que los guarda.

use super::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultInfo {
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub open_last_vault: bool,
    pub animations: bool,
    pub accent: String,
    pub editor_font_size: u8,
    pub ui_zoom: u16,
    pub auto_save: bool,
    pub hide_completed_tasks: bool,
    pub calendar_show_completed: bool,
    /// Diccionarios del corrector, uno o varios a la vez. Vacío = apagado.
    pub spell_langs: Vec<String>,
    pub spell_words: Vec<String>,
    /// Atajos de teclado cambiados a mano (id → combinación).
    pub shortcuts: std::collections::BTreeMap<String, String>,
    /// Carpeta del vault donde viven las notas diarias.
    pub daily_notes_folder: String,
    /// Plantilla con la que se crea la nota de un día nuevo.
    pub daily_notes_template: String,
    /// Avisos del sistema (vencimientos y nota del día). Opt-in.
    pub notifications_enabled: bool,
    /// Días de antelación con los que se avisa del vencimiento de una tarea.
    pub notification_lead_days: u8,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            open_last_vault: true,
            animations: true,
            accent: "terracota".into(),
            editor_font_size: 14,
            ui_zoom: 100,
            auto_save: true,
            hide_completed_tasks: false,
            calendar_show_completed: true,
            spell_langs: vec!["es".into()],
            spell_words: Vec::new(),
            shortcuts: Default::default(),
            daily_notes_folder: "Diario".into(),
            daily_notes_template: "# {title}\n\n## Tareas\n\n- [ ] \n\n## Notas\n\n".into(),
            // Opt-in: la privacidad es un principio del proyecto, así que los
            // avisos están apagados hasta que alguien los enciende.
            notifications_enabled: false,
            notification_lead_days: 1,
        }
    }
}

/// Teclas con nombre propio que puede formar parte de un atajo.
pub(crate) const NAMED_KEYS: [&str; 13] = [
    "arrowup", "arrowdown", "arrowleft", "arrowright", "escape", "enter", "backspace", "delete",
    "tab", "space", "home", "end", "insert",
];

/// Un segmento de carpeta sin caracteres prohibidos en nombres de archivo
/// (equivalente a `safeFileName` del frontend). Devuelve vacío si no queda
/// nada utilizable, para que el llamador lo descarte.
pub(crate) fn sanitize_folder_segment(raw: &str) -> String {
    let without_ext = raw.strip_suffix(".md").unwrap_or(raw);
    let cleaned: String = without_ext
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches('.');
    trimmed.to_string()
}

impl AppSettings {
    /// Colores de acento aceptados (deben coincidir con los del frontend).
    pub(crate) const ACCENTS: [&'static str; 4] = ["terracota", "menta", "marfil", "cielo"];

    /// Diccionarios aceptados (deben coincidir con los del frontend). Se
    /// pueden activar varios a la vez; sin ninguno el corrector se apaga.
    pub(crate) const SPELL_LANGS: [&'static str; 7] = ["es", "en-US", "en-GB", "fr", "de", "pt-BR", "it"];

    /// Acciones con atajo conocido. Lo que no esté aquí se descarta, para que
    /// un `config.json` escrito a mano no guarde combinaciones huérfanas.
    pub(crate) const SHORTCUT_IDS: [&'static str; 27] = [
        "commandPalette", "saveNote", "newNote", "newFolder", "newTask", "openDailyNote",
        "exportPdf", "toggleView", "undo", "redo", "zoomIn", "zoomOut", "zoomReset",
        "focusSearch", "togglePanel", "back", "forward", "parentFolder", "bold", "italic",
        "underline", "strikethrough", "inlineCode", "copyCell", "cutCell", "moveLineUp",
        "moveLineDown",
    ];

    /// Corrige valores escritos a mano en el `config.json` (nunca falla).
    pub(crate) fn sanitize(&mut self) {
        if !Self::ACCENTS.contains(&self.accent.as_str()) {
            self.accent = Self::default().accent;
        }

        // Diccionarios: se quitan los que no existan y las repeticiones, en el
        // orden elegido. Una lista vacía es válida (corrector apagado).
        let mut langs: Vec<String> = Vec::new();
        for raw in std::mem::take(&mut self.spell_langs) {
            if !Self::SPELL_LANGS.contains(&raw.as_str()) || langs.contains(&raw) {
                continue;
            }
            langs.push(raw);
        }
        self.spell_langs = langs;

        self.editor_font_size = self.editor_font_size.clamp(12, 22);
        self.ui_zoom = self.ui_zoom.clamp(50, 200);

        // Atajos: solo los que existen y con una forma de combinación legible
        // («ctrl+shift+k»); lo demás se cae al valor de por defecto del frontend.
        let mut shortcuts: std::collections::BTreeMap<String, String> = Default::default();
        for (id, combo) in std::mem::take(&mut self.shortcuts) {
            if !Self::SHORTCUT_IDS.contains(&id.as_str()) {
                continue;
            }
            let parts: Vec<String> = combo
                .split('+')
                .map(|part| part.trim().to_ascii_lowercase())
                .filter(|part| !part.is_empty())
                .collect();
            // Ha de ser una sola tecla, con o sin modificadores.
            if parts.is_empty() || parts.len() > 4 {
                continue;
            }
            let known = parts.iter().all(|part| {
                matches!(
                    part.as_str(),
                    "ctrl" | "cmd" | "mod" | "meta" | "alt" | "option" | "opt" | "shift"
                ) || part.chars().count() == 1
                    || NAMED_KEYS.contains(&part.as_str())
            });
            if !known {
                continue;
            }
            shortcuts.insert(id, parts.join("+"));
        }
        self.shortcuts = shortcuts;

        let mut words: Vec<String> = Vec::new();
        for raw in std::mem::take(&mut self.spell_words) {
            let word: String = raw.trim().chars().take(64).collect();
            if word.is_empty() || words.contains(&word) {
                continue;
            }
            words.push(word);
        }
        self.spell_words = words;

        // Días de antelación de los avisos: rango corto y redondo. Un valor
        // fuera de serie vuelve al default en lugar de quedarse raro.
        const LEAD_DAYS: [u8; 5] = [0, 1, 3, 7, 14];
        if !LEAD_DAYS.contains(&self.notification_lead_days) {
            self.notification_lead_days = Self::default().notification_lead_days;
        }

        // Carpeta de diarios: segmentos sin caracteres prohibidos y con un
        // tope de profundidad; lo que no deje nada usable vuelve al default.
        let segments: Vec<String> = self
            .daily_notes_folder
            .replace('\\', "/")
            .split('/')
            .map(|segment| sanitize_folder_segment(segment.trim()))
            .filter(|segment| !segment.is_empty())
            .take(4)
            .collect();
        self.daily_notes_folder = if segments.is_empty() {
            Self::default().daily_notes_folder
        } else {
            segments.join("/")
        };

        // Plantilla: saltos de línea normalizados y longitud topada. Una
        // plantilla vacía es válida (nota en blanco).
        let template: String = self
            .daily_notes_template
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .chars()
            .take(4000)
            .collect();
        self.daily_notes_template = template;
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub base_dir: Option<String>,
    pub vaults: Vec<VaultInfo>,
    pub last_vault: Option<String>,
    pub settings: AppSettings,
}

pub(crate) fn default_vaults_base() -> String {
    match home_dir() {
        Some(home) => format!("{home}/Documents/gus-vaults"),
        None => "~/Documents/gus-vaults".to_string(),
    }
}

pub(crate) fn config_file_path() -> Option<std::path::PathBuf> {
    match std::env::consts::OS {
        "windows" => std::env::var_os("APPDATA")
            .map(|dir| std::path::PathBuf::from(dir).join("gus").join("config.json")),
        "macos" => home_dir().map(|home| {
            std::path::PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("gus")
                .join("config.json")
        }),
        _ => {
            if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
                if !xdg.is_empty() {
                    return Some(std::path::PathBuf::from(xdg).join("gus").join("config.json"));
                }
            }
            home_dir().map(|home| {
                std::path::PathBuf::from(home)
                    .join(".config")
                    .join("gus")
                    .join("config.json")
            })
        }
    }
}

pub(crate) fn load_config_from(path: &std::path::Path) -> AppConfig {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return AppConfig::default();
    };

    match serde_json::from_str::<AppConfig>(&raw) {
        Ok(mut config) => {
            config.settings.sanitize();
            config
        }
        Err(_) => AppConfig::default(),
    }
}

pub(crate) fn save_config_to(path: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config)
        .map_err(|err| format!("No se pudo serializar la configuración: {err}"))?;

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("No se pudo crear «{}»: {err}", parent.display()))?;
        }
    }

    std::fs::write(path, raw)
        .map_err(|err| format!("No se pudo escribir la configuración: {err}"))
}

#[tauri::command]
pub(crate) fn load_app_config() -> AppConfig {
    let mut config = match config_file_path() {
        Some(path) => load_config_from(&path),
        None => AppConfig::default(),
    };

    if config.base_dir.is_none() {
        config.base_dir = Some(default_vaults_base());
    }

    config
}

#[tauri::command]
pub(crate) fn save_app_config(config: AppConfig) -> Result<(), String> {
    let path = config_file_path()
        .ok_or_else(|| "No se encontró el directorio de configuración".to_string())?;

    save_config_to(&path, &config)
}
