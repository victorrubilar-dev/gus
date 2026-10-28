//! Tests de la raíz del crate (vault, papelera, listados, medios, búsqueda, tareas).

use super::*;

fn temp_vault(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("gus-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp vault");
    dir
}

/** Codificador de referencia para contrastar `decode_base64`. */
fn to_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();

    for chunk in bytes.chunks(3) {
        let tail = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let packed =
            (u32::from(tail[0]) << 16) | (u32::from(tail[1]) << 8) | u32::from(tail[2]);
        out.push(ALPHABET[(packed >> 18) as usize & 63] as char);
        out.push(ALPHABET[(packed >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(packed >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[packed as usize & 63] as char
        } else {
            '='
        });
    }

    out
}

#[test]
fn decode_base64_matches_reference_encoder() {
    let cases: [&[u8]; 7] = [
        b"",
        b"A",
        b"AB",
        b"ABC",
        b"ABCD",
        b"%PDF-1.7\n",
        &[0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255],
    ];

    for bytes in cases {
        let encoded = to_base64(bytes);
        assert_eq!(
            decode_base64(&encoded).expect("base64 válido"),
            bytes.to_vec(),
            "fallo con {encoded:?}",
        );
        // El relleno y los saltos de línea no deben confundir al lector.
        let wrapped = encoded.replace('-', "+").replace('_', "/");
        assert_eq!(decode_base64(&wrapped).expect("base64 válido"), bytes.to_vec());
    }
}

#[test]
fn decode_base64_rejects_invalid_characters() {
    assert!(decode_base64("hola??").is_err());
    assert!(decode_base64("abc$").is_err());
    assert!(decode_base64("ññññ").is_err());
}

#[test]
fn write_pdf_file_saves_decoded_bytes_and_completes_extension() {
    let dir = temp_vault("pdf-export");
    let target = dir.join("nota.pdf");
    let payload = b"%PDF-1.7\nfin";

    write_pdf_file(
        target.to_string_lossy().into_owned(),
        to_base64(payload),
    )
    .expect("escribir el pdf");

    assert_eq!(std::fs::read(&target).expect("leer el pdf"), payload);

    // Si el diálogo no añadió la extensión, se completa.
    let bare = dir.join("sin-extension");
    write_pdf_file(bare.to_string_lossy().into_owned(), to_base64(b"x")).expect("escribir");
    assert!(dir.join("sin-extension.pdf").exists());
    assert!(!bare.exists());
}

#[test]
fn read_vault_dir_filters_non_md_files() {
    let dir = temp_vault("vault-test");

    std::fs::write(dir.join("bienvenida.md"), "# Hola").expect("write md");
    std::fs::write(dir.join("README.txt"), "no soy md").expect("write txt");
    std::fs::write(dir.join("NOTAS.MD"), "# Mayúsculas").expect("write MD");
    std::fs::create_dir(dir.join("carpeta.md")).expect("create dir with .md name");

    let path = dir.to_string_lossy().into_owned();
    let items = read_vault_dir(path.clone()).expect("read vault");

    let names: Vec<&str> = items.iter().map(|item| item.name.as_str()).collect();
    assert_eq!(names, vec!["bienvenida.md", "NOTAS.MD"]);
    assert_eq!(items[0].path, dir.join("bienvenida.md").to_string_lossy());
    assert_eq!(items[0].size, 6);
    assert!(items[0].modified_ms.is_some());

    let missing = format!("{path}/no-existe");
    let created = read_vault_dir(missing.clone()).expect("create and read");
    assert!(created.is_empty());
    assert!(std::path::Path::new(&missing).is_dir());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn get_vault_files_returns_name_and_modified() {
    let dir = temp_vault("vault-files");

    std::fs::write(dir.join("zeta.md"), "z").expect("write md");
    std::fs::write(dir.join("alpha.md"), "alpha").expect("write md");
    std::fs::write(dir.join("notas.txt"), "x").expect("write txt");

    let path = dir.to_string_lossy().into_owned();
    let files = get_vault_files(path).expect("get vault files");

    let names: Vec<&str> = files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(names, vec!["alpha.md", "zeta.md"]);
    for file in &files {
        assert!(file.path.ends_with(&file.name));
        assert!(file.modified_ms.is_some());
    }

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_recent_notes_ordena_por_fecha_y_omite_ocultas() {
    use std::time::{Duration, SystemTime};

    let dir = temp_vault("recent-notes");
    std::fs::create_dir(dir.join("viajes")).expect("subdir");
    std::fs::create_dir(dir.join(".oculta")).expect("hidden dir");

    std::fs::write(dir.join("vieja.md"), "vieja").expect("write md");
    std::fs::write(dir.join("viajes").join("intermedia.md"), "intermedia").expect("sub md");
    std::fs::write(dir.join("nueva.md"), "nueva").expect("write md");
    std::fs::write(dir.join("no-md.txt"), "x").expect("write txt");
    std::fs::write(dir.join(".oculta").join("secreta.md"), "oculta").expect("hidden md");

    let now = SystemTime::now();
    let touch = |name: &str, age: Duration| {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(dir.join(name))
            .expect("open for mtime");
        file.set_modified(now - age).expect("mtime");
    };
    touch("vieja.md", Duration::from_secs(3 * 24 * 3600));
    touch("viajes/intermedia.md", Duration::from_secs(24 * 3600));
    touch("nueva.md", Duration::from_secs(60));
    touch(".oculta/secreta.md", Duration::ZERO);

    let path = dir.to_string_lossy().into_owned();
    let notes = list_recent_notes(path.clone(), 10).expect("list");

    let relatives: Vec<&str> = notes.iter().map(|note| note.relative.as_str()).collect();
    assert_eq!(
        relatives,
        vec!["nueva.md", "viajes/intermedia.md", "vieja.md"],
        "orden = {relatives:?}"
    );
    assert_eq!(notes[1].name, "intermedia.md");
    assert!(
        notes.iter().all(|note| !note.relative.contains(".oculta")),
        "las carpetas ocultas no aparecen"
    );
    assert!(notes.iter().all(|note| note.modified_ms.is_some()));

    assert_eq!(
        list_recent_notes(path.clone(), 2).expect("limit 2").len(),
        2
    );
    assert!(list_recent_notes(path.clone(), 0)
        .expect("limit 0")
        .is_empty());

    assert!(list_recent_notes(format!("{path}/no-existe"), 5).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_vault_notes_devuelve_todas_las_notas_ordenadas() {
    let dir = temp_vault("palette-notes");
    std::fs::create_dir(dir.join("viajes")).expect("subdir");
    std::fs::create_dir(dir.join(".oculta")).expect("hidden dir");

    std::fs::write(dir.join("zeta.md"), "z").expect("write md");
    std::fs::write(dir.join("alpha.md"), "a").expect("write md");
    std::fs::write(dir.join("viajes").join("paris.md"), "p").expect("sub md");
    std::fs::write(dir.join("notas.txt"), "x").expect("write txt");
    std::fs::write(dir.join(".oculta").join("secreta.md"), "s").expect("hidden md");

    let path = dir.to_string_lossy().into_owned();
    let notes = list_vault_notes(path.clone()).expect("list");

    let relatives: Vec<&str> = notes.iter().map(|note| note.relative.as_str()).collect();
    assert_eq!(
        relatives,
        vec!["alpha.md", "viajes/paris.md", "zeta.md"],
        "orden alfabético = {relatives:?}"
    );
    assert_eq!(notes[1].name, "paris.md");
    assert!(
        notes.iter().all(|note| !note.relative.contains(".oculta")),
        "las carpetas ocultas no aparecen"
    );
    assert!(notes.iter().all(|note| note.path.ends_with(".md")));

    assert!(list_vault_notes(format!("{path}/no-existe")).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn frontmatter_tags_lee_flujo_bloque_y_comillas() {
    assert_eq!(
        frontmatter_tags("---\ntags: [casa, \"a: b\"]\n---\nTexto"),
        vec!["casa", "a: b"]
    );
    // Las etiquetas con espacios no se parten: solo la coma separa.
    assert_eq!(
        frontmatter_tags("---\ntags: [Unidad 2, Examen final]\n---\nX"),
        vec!["Unidad 2", "Examen final"]
    );
    assert_eq!(
        frontmatter_tags("---\ntags:\n- Unidad 2\n---\nX"),
        vec!["Unidad 2"]
    );
    assert_eq!(
        frontmatter_tags("---\ntags:\n- uno\n- dos\ntitle: X\n---\nTexto"),
        vec!["uno", "dos"]
    );
    assert_eq!(
        frontmatter_tags("---\ntags: [#Casa, casa, CASA]\n---\nX"),
        vec!["Casa"]
    );
    assert_eq!(
        frontmatter_tags("---\ntitle: Solo título\n---\nX"),
        Vec::<String>::new()
    );
    assert_eq!(frontmatter_tags("Texto normal"), Vec::<String>::new());
    assert_eq!(
        frontmatter_tags("---\nsin propiedades\n---\nX"),
        Vec::<String>::new()
    );
    assert_eq!(
        frontmatter_tags("# Título\n---\ntags: [x]\n---"),
        Vec::<String>::new()
    );
}

#[test]
fn list_vault_tags_recoge_las_etiquetas_de_todo_el_vault() {
    let dir = temp_vault("vault-tags");
    std::fs::create_dir(dir.join("viajes")).expect("subdir");

    std::fs::write(dir.join("a.md"), "---\ntags: [casa, viaje]\n---\n# A").expect("write a");
    std::fs::write(
        dir.join("viajes").join("b.md"),
        "---\ntags:\n- Casa\n- #playa\n---\n# B",
    )
    .expect("write b");
    std::fs::write(dir.join("c.md"), "# C sin etiquetas").expect("write c");
    std::fs::write(dir.join("d.md"), "---\ntitle: Solo título\n---\n# D").expect("write d");
    std::fs::write(dir.join("notas.txt"), "tags: [ignorado]").expect("write txt");

    let path = dir.to_string_lossy().into_owned();
    let tags = list_vault_tags(path.clone()).expect("tags");

    let pairs: Vec<(String, usize)> = tags
        .iter()
        .map(|entry| (entry.tag.to_lowercase(), entry.count))
        .collect();
    assert_eq!(
        pairs,
        vec![("casa".to_string(), 2), ("playa".to_string(), 1), ("viaje".to_string(), 1)],
        "las notas con y sin etiquetas se cuentan bien: {pairs:?}"
    );

    assert!(list_vault_tags(format!("{path}/no-existe")).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_vault_dir_creates_missing_folders() {
    let base = temp_vault("vault-missing");
    let nested = base.join("carpeta").join("profunda");

    let items = read_vault_dir(nested.to_string_lossy().into_owned()).expect("create nested");
    assert!(items.is_empty());
    assert!(nested.is_dir());

    let from_files = get_vault_files(nested.to_string_lossy().into_owned()).expect("list nested");
    assert!(from_files.is_empty());

    let file = base.join("nota.md");
    std::fs::write(&file, "# x").expect("write file");
    assert!(read_vault_dir(file.to_string_lossy().into_owned()).is_err());

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn write_vault_file_creates_missing_subdirs() {
    let base = temp_vault("vault-write-subdir");
    let note = base.join("proyectos").join("gus").join("idea.md");
    assert!(!note.parent().expect("parent").exists());

    let path = note.to_string_lossy().into_owned();
    let content = "# Idea\n\n- [ ] probarla #dev\n";

    write_vault_file(path.clone(), content.to_string()).expect("write into missing subdir");
    assert!(note.is_file());
    assert!(note.parent().expect("parent").is_dir());

    assert_eq!(read_vault_file(path).expect("read back"), content);

    write_vault_file(
        note.to_string_lossy().into_owned(),
        "# Idea v2\n".to_string(),
    )
    .expect("rewrite");
    assert_eq!(
        read_vault_file(note.to_string_lossy().into_owned()).expect("read again"),
        "# Idea v2\n"
    );

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn rename_vault_file_moves_and_protects() {
    let base = temp_vault("vault-rename");

    let from = base.join("borrador.md");
    write_vault_file(from.to_string_lossy().into_owned(), "# Borrador\n".into())
        .expect("write");

    let to = base.join("archivo").join("final.md");
    let to_path = to.to_string_lossy().into_owned();
    let renamed =
        rename_vault_file(from.to_string_lossy().into_owned(), to_path.clone()).expect("rename");

    assert_eq!(renamed, to_path);
    assert!(!from.exists());
    assert!(to.is_file());
    assert_eq!(read_vault_file(to_path.clone()).expect("read"), "# Borrador\n");

    let other = base.join("otro.md");
    write_vault_file(other.to_string_lossy().into_owned(), "# Otro\n".into()).expect("write");
    assert!(rename_vault_file(other.to_string_lossy().into_owned(), to_path.clone()).is_err());
    assert_eq!(read_vault_file(to_path.clone()).expect("read"), "# Borrador\n");

    let txt = base.join("nota.txt").to_string_lossy().into_owned();
    std::fs::write(&txt, "x").expect("write txt");
    assert!(rename_vault_file(txt, base.join("ok.md").to_string_lossy().into_owned()).is_err());

    assert_eq!(
        rename_vault_file(to_path.clone(), to_path.clone()).expect("same path"),
        to_path
    );

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn expand_home_only_touches_home_paths() {
    assert_eq!(expand_home("/tmp/vault"), "/tmp/vault");
    assert_eq!(expand_home("vault/rel"), "vault/rel");

    if let Some(home) = home_dir() {
        assert_eq!(expand_home("~"), home);
        assert_eq!(expand_home("~/vault"), format!("{home}/vault"));
    } else {
        assert_eq!(expand_home("~/vault"), "~/vault");
    }
}

#[test]
fn read_write_vault_file_roundtrip() {
    let dir = temp_vault("vault-note");
    let note = dir.join("nota.md");
    let path = note.to_string_lossy().into_owned();

    write_vault_file(path.clone(), "# Hola\n\n- [ ] prueba\n".into()).expect("write");
    let content = read_vault_file(path.clone()).expect("read");
    assert_eq!(content, "# Hola\n\n- [ ] prueba\n");

    let txt = dir.join("no.md.txt").to_string_lossy().into_owned();
    assert!(read_vault_file(txt.clone()).is_err());
    assert!(write_vault_file(txt, "x".into()).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn create_vault_file_escribe_y_no_sobrescribe() {
    let dir = temp_vault("crud-create-file");
    let path = dir.join("nota.md").to_string_lossy().into_owned();

    let created = create_vault_file(path.clone(), "# Hola".into()).expect("debe crearse");
    assert_eq!(created, path);
    assert_eq!(std::fs::read_to_string(&created).expect("read"), "# Hola");

    let other = create_vault_file(path.clone(), "# Otra".into()).expect("debe crearse");
    assert_ne!(other, path);
    assert!(other.ends_with("nota-2.md"), "ruta = {other}");
    assert_eq!(std::fs::read_to_string(&path).expect("read"), "# Hola");

    let nested = dir.join("apuntes/mates/funciones.md").to_string_lossy().into_owned();
    let created = create_vault_file(nested.clone(), String::new()).expect("debe crearse");
    assert_eq!(created, nested);
    assert!(std::path::Path::new(&created).is_file());

    let txt = dir.join("nota.txt").to_string_lossy().into_owned();
    let err =
        create_vault_file(txt, String::new()).expect_err("la extensión .txt debe rechazarse");
    assert!(err.contains(".md"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn create_vault_dir_crea_y_no_ambigua() {
    let dir = temp_vault("crud-create-dir");
    let path = dir.join("proyectos").to_string_lossy().into_owned();

    let created = create_vault_dir(path.clone()).expect("debe crearse");
    assert_eq!(created, path);
    assert!(std::path::Path::new(&created).is_dir());

    let other = create_vault_dir(path).expect("debe crear una variante");
    assert!(other.ends_with("proyectos-2"), "ruta = {other}");

    let occupied = dir.join("archivo.md");
    std::fs::write(&occupied, "").expect("write");
    let err = create_vault_dir(occupied.to_string_lossy().into_owned())
        .expect_err("hay un archivo ahí");
    assert!(err.contains("archivo"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn import_files_to_vault_copia_lo_admitido_y_explica_lo_demás() {
    let dir = temp_vault("import");
    let origen = dir.join("descargas");
    let vault = dir.join("vault");
    std::fs::create_dir_all(&origen).expect("origen");

    std::fs::write(origen.join("nota.md"), "# Hola\n").expect("md");
    std::fs::write(origen.join("manual.pdf"), "%PDF-1.4").expect("pdf");
    std::fs::write(origen.join("foto.jpeg"), [1, 2, 3]).expect("jpeg");
    std::fs::write(origen.join("datos.zip"), [9]).expect("zip");
    std::fs::create_dir(origen.join("carpeta")).expect("carpeta");

    let ruta = |name: &str| origen.join(name).to_string_lossy().into_owned();
    let sources = vec![
        ruta("nota.md"),
        ruta("manual.pdf"),
        ruta("foto.jpeg"),
        ruta("datos.zip"),
        ruta("carpeta"),
        ruta("fantasma.md"),
    ];

    // La carpeta de destino se crea si no existía.
    let items =
        import_files_to_vault(sources, vault.to_string_lossy().into_owned()).expect("importar");
    assert_eq!(items.len(), 6, "un resultado por archivo");

    assert_eq!(
        std::fs::read_to_string(vault.join("nota.md")).expect("md copiado"),
        "# Hola\n"
    );
    assert!(vault.join("manual.pdf").exists(), "pdf copiado");
    assert!(vault.join("foto.jpeg").exists(), "imagen copiada");
    assert_eq!(
        std::fs::read_to_string(origen.join("nota.md")).expect("original intacto"),
        "# Hola\n",
        "se copia, no se mueve"
    );

    assert!(items[0].error.is_none(), "{:?}", items[0]);
    assert!(
        items[0]
            .path
            .as_deref()
            .is_some_and(|path| path.ends_with("nota.md")),
        "{:?}",
        items[0]
    );

    assert!(items[3].path.is_none(), "el .zip no se añade");
    assert!(
        items[3].error.as_deref().is_some_and(|err| err.contains(".md")),
        "{:?}",
        items[3]
    );

    assert!(items[4].path.is_none(), "las carpetas no se añaden");
    assert!(
        items[4]
            .error
            .as_deref()
            .is_some_and(|err| err.contains("carpeta")),
        "{:?}",
        items[4]
    );

    assert!(items[5].path.is_none(), "el archivo fantasma no se añade");
    assert!(
        items[5]
            .error
            .as_deref()
            .is_some_and(|err| err.contains("No existe")),
        "{:?}",
        items[5]
    );

    // Segunda tanda con el mismo nombre: no pisa, crea una variante.
    let otra =
        import_files_to_vault(vec![ruta("nota.md")], vault.to_string_lossy().into_owned())
            .expect("importar otra vez");
    assert!(
        otra[0]
            .path
            .as_deref()
            .is_some_and(|path| path.ends_with("nota-2.md")),
        "{:?}",
        otra[0]
    );
    assert_eq!(
        std::fs::read_to_string(vault.join("nota.md")).expect("primera"),
        "# Hola\n",
        "la primera copia no se toca"
    );

    // Un .md que no es UTF-8 no sirve para el editor.
    std::fs::write(origen.join("rota.md"), [0xff, 0xfe, b'A']).expect("binario");
    let rota =
        import_files_to_vault(vec![ruta("rota.md")], vault.to_string_lossy().into_owned())
            .expect("importar rota");
    assert!(rota[0].path.is_none(), "{:?}", rota[0]);
    assert!(
        rota[0].error.as_deref().is_some_and(|err| err.contains("UTF-8")),
        "{:?}",
        rota[0]
    );

    // El archivo ya está en la carpeta: se omite en lugar de duplicarse.
    let ya = import_files_to_vault(
        vec![vault.join("manual.pdf").to_string_lossy().into_owned()],
        vault.to_string_lossy().into_owned(),
    )
    .expect("importar el que ya está");
    assert!(
        ya[0]
            .path
            .as_deref()
            .is_some_and(|path| path.ends_with("manual.pdf")),
        "{:?}",
        ya[0]
    );
    assert!(
        ya[0]
            .error
            .as_deref()
            .is_some_and(|err| err.contains("ya estaba")),
        "{:?}",
        ya[0]
    );
    assert!(!vault.join("manual-2.pdf").exists(), "no se duplica");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn delete_vault_file_quita_el_archivo() {
    let dir = temp_vault("crud-delete");
    let path = dir.join("borrar.md");
    std::fs::write(&path, "x").expect("write");
    let path = path.to_string_lossy().into_owned();

    delete_vault_file(path.clone()).expect("debe eliminarse");
    assert!(!std::path::Path::new(&path).exists());

    let err = delete_vault_file(path).expect_err("ya no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");

    let log = dir.join("fuga.log").to_string_lossy().into_owned();
    let err =
        delete_vault_file(log).expect_err("la extensión .log debe rechazarse");
    assert!(err.contains(".md"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn move_to_trash_mueve_a_la_papelera_oculta_y_la_crea() {
    let dir = temp_vault("trash");

    let trash = vault_trash(&dir);
    assert_eq!(trash, dir.join(".gus-trash"));
    assert!(!trash.exists(), "la papelera aún no existe");

    let nota = dir.join("nota.md");
    std::fs::write(&nota, "contenido").expect("write md");

    let moved = move_path_to_trash(&nota, &trash).expect("debe moverse");

    assert!(!nota.exists(), "el original desaparece del vault");
    assert!(trash.is_dir(), "la papelera se crea sola");
    assert_eq!(moved, trash.join("nota.md"));
    assert_eq!(
        std::fs::read_to_string(&moved).expect("leer en la papelera"),
        "contenido"
    );

    std::fs::create_dir(dir.join("otra")).expect("subdir");
    let otra = dir.join("otra").join("nota.md");
    std::fs::write(&otra, "otra").expect("write md");
    let segunda = move_path_to_trash(&otra, &trash).expect("debe moverse 2");
    assert_eq!(segunda, trash.join("nota-2.md"));
    assert_eq!(
        std::fs::read_to_string(trash.join("nota.md")).expect("primera"),
        "contenido"
    );
    assert_eq!(
        std::fs::read_to_string(&segunda).expect("segunda"),
        "otra"
    );

    let falta = dir.join("fantasma.md");
    let vacia = dir.join(".gus-trash-vacia");
    let err = move_path_to_trash(&falta, &vacia).expect_err("no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");
    assert!(!vacia.exists());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn papelera_lista_restaura_y_elimina_definitivamente() {
    let dir = temp_vault("trash-ui");
    let trash = dir.join(".gus-trash");
    let vault = dir.join("vault");
    std::fs::create_dir_all(&vault).expect("vault");

    let nota = vault.join("nota.md");
    std::fs::write(&nota, "hola").expect("write md");

    assert!(list_trash_items(&trash).expect("listar").is_empty());

    let tirada = trash_entry(&nota, &trash).expect("tirar");
    assert!(!nota.exists(), "el original ya no está en el vault");

    let items = list_trash_items(&trash).expect("listar");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].name, "nota.md");
    assert_eq!(items[0].size, 4);
    assert!(!items[0].is_dir);
    assert_eq!(
        items[0].origin.as_deref(),
        Some(nota.to_string_lossy().as_ref())
    );
    assert!(items[0].trashed_at_ms.is_some());
    assert!(items[0].modified_ms.is_some());

    let restaurada = restore_trashed(&tirada, &trash).expect("restaurar");
    assert_eq!(restaurada, nota.to_string_lossy().into_owned());
    assert_eq!(std::fs::read_to_string(&nota).expect("leer"), "hola");
    assert!(list_trash_items(&trash).expect("listar").is_empty());

    let tirada = trash_entry(&nota, &trash).expect("tirar 2");
    std::fs::write(&nota, "nuevo").expect("write md");
    let restaurada = restore_trashed(&tirada, &trash).expect("restaurar 2");
    assert!(restaurada.ends_with("nota-2.md"), "ruta = {restaurada}");
    assert_eq!(std::fs::read_to_string(&nota).expect("leer"), "nuevo");
    assert_eq!(
        std::fs::read_to_string(&restaurada).expect("leer 2"),
        "hola"
    );

    let tirada = trash_entry(&nota, &trash).expect("tirar 3");
    delete_trashed(&tirada, &trash).expect("borrar");
    assert!(!tirada.exists());
    assert!(list_trash_items(&trash).expect("listar").is_empty());

    let err = restore_trashed(&nota, &trash).expect_err("fuera de la papelera");
    assert!(err.contains("fuera de la papelera"), "mensaje = {err}");
    let err = delete_trashed(&nota, &trash).expect_err("fuera de la papelera");
    assert!(err.contains("fuera de la papelera"), "mensaje = {err}");

    let otra = vault.join("otra.md");
    std::fs::write(&otra, "x").expect("write md");
    trash_entry(&otra, &trash).expect("tirar 4");
    empty_trash_dir(&trash).expect("vaciar");
    assert!(list_trash_items(&trash).expect("listar").is_empty());
    assert!(!trash.join(TRASH_MANIFEST).exists(), "sin manifiesto");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn papelera_acepta_carpetas_y_las_restaura_con_su_contenido() {
    let dir = temp_vault("trash-folders");
    let trash = dir.join(".gus-trash");
    let carpeta = dir.join("vault").join("viajes");
    std::fs::create_dir_all(carpeta.join("fotos")).expect("subdir");
    std::fs::write(carpeta.join("plan.md"), "# plan").expect("write md");
    std::fs::write(carpeta.join("fotos").join("paris.md"), "# paris").expect("write md");

    ensure_trashable_dir(&carpeta, &trash).expect("carpeta normal");

    let tirada = trash_entry(&carpeta, &trash).expect("tirar carpeta");
    assert!(!carpeta.exists(), "la carpeta sale del vault");
    assert!(tirada.is_dir(), "va entera a la papelera");
    assert_eq!(
        std::fs::read_to_string(tirada.join("plan.md")).expect("leer en la papelera"),
        "# plan"
    );

    let items = list_trash_items(&trash).expect("listar");
    assert_eq!(items.len(), 1);
    assert!(items[0].is_dir, "la papelera la lista como carpeta");
    assert_eq!(items[0].size, 0, "las carpetas no informan tamaño");
    assert_eq!(
        items[0].origin.as_deref(),
        Some(carpeta.to_string_lossy().as_ref())
    );

    let devuelta = restore_trashed(&tirada, &trash).expect("restaurar");
    assert_eq!(devuelta, carpeta.to_string_lossy().into_owned());
    assert_eq!(
        std::fs::read_to_string(carpeta.join("plan.md")).expect("leer"),
        "# plan"
    );
    assert!(
        carpeta.join("fotos").join("paris.md").exists(),
        "las subcarpetas vuelven enteras"
    );
    assert!(list_trash_items(&trash).expect("listar").is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn ensure_trashable_dir_rechaza_raices_y_la_papelera() {
    let dir = temp_vault("trash-guards");
    let trash = dir.join(".gus-trash");
    std::fs::create_dir_all(&trash).expect("trash");
    std::fs::create_dir_all(dir.join("vault").join("ok")).expect("folder");

    let err = ensure_trashable_dir(&dir.join("fantasma"), &trash).expect_err("no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");

    let err = ensure_trashable_dir(std::path::Path::new("/"), &trash).expect_err("raíz");
    assert!(err.contains("raíz"), "mensaje = {err}");

    let err = ensure_trashable_dir(&trash, &trash).expect_err("papelera");
    assert!(err.contains("no se puede tirar"), "mensaje = {err}");
    let err = ensure_trashable_dir(&dir, &trash).expect_err("contenedora");
    assert!(err.contains("no se puede tirar"), "mensaje = {err}");

    ensure_trashable_dir(&dir.join("vault").join("ok"), &trash).expect("carpeta normal");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn papelera_admite_cualquier_tipo_de_archivo() {
    let dir = temp_vault("trash-any");
    let trash = dir.join(".gus-trash");
    let vault = dir.join("vault");
    std::fs::create_dir_all(&vault).expect("vault");

    let nombres = [
        "nota.md",
        "manual.pdf",
        "foto.jpg",
        "captura.png",
        "avatar.ico",
        "escaneo.tiff",
        "datos.txt",
        "backup.zip",
    ];

    for name in nombres {
        std::fs::write(vault.join(name), name).expect("write");
    }

    for name in nombres {
        let source = vault.join(name);
        let tirado = trash_entry_if_safe(&source, &trash)
            .unwrap_or_else(|err| panic!("«{name}» debe caber en la papelera: {err}"));
        assert!(!source.exists(), "«{name}» sale del vault");
        assert!(tirado.exists(), "«{name}» acaba en la papelera");
    }

    let items = list_trash_items(&trash).expect("listar");
    assert_eq!(items.len(), nombres.len());

    // Restaurar también vale para archivos que no son .md ni imágenes.
    let restaurada =
        restore_trashed(&trash.join("manual.pdf"), &trash).expect("restaurar el pdf");
    assert!(restaurada.ends_with("manual.pdf"), "ruta = {restaurada}");
    assert!(std::path::Path::new(&restaurada).exists());

    // Nada de tirar la papelera dentro de sí misma.
    let dentro = trash.join("datos.txt");
    let err = trash_entry_if_safe(&dentro, &trash).expect_err("ya está en la papelera");
    assert!(err.contains("ya está dentro"), "mensaje = {err}");

    let err = trash_entry_if_safe(&vault.join("fantasma.zip"), &trash)
        .expect_err("no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn ensure_entry_admite_md_pdf_e_imagenes() {
    ensure_entry("/vault/nota.md").expect("md");
    ensure_entry("/vault/manual.pdf").expect("pdf");
    ensure_entry("/vault/foto.jpeg").expect("jpeg");
    ensure_entry("/vault/escaneo.tiff").expect("tiff");
    ensure_entry("/vault/logo.svg").expect("svg");

    let err = ensure_entry("/vault/datos.zip").expect_err("zip");
    assert!(err.contains(".md"), "mensaje = {err}");
}

#[test]
fn copy_dir_all_copia_el_arbol_completo() {
    let dir = temp_vault("copy-tree");
    let origen = dir.join("origen");
    std::fs::create_dir_all(origen.join("anidada")).expect("subdirs");
    std::fs::write(origen.join("a.md"), "a").expect("write a");
    std::fs::write(origen.join("anidada").join("b.md"), "b").expect("write b");

    let destino = dir.join("destino");
    copy_dir_all(&origen, &destino).expect("copiar");

    assert_eq!(
        std::fs::read_to_string(destino.join("a.md")).expect("a"),
        "a"
    );
    assert_eq!(
        std::fs::read_to_string(destino.join("anidada").join("b.md")).expect("b"),
        "b"
    );
    assert!(origen.exists(), "la copia no retira el original");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn papelera_purga_cada_elemento_a_los_30_dias() {
    let dir = temp_vault("trash-ttl");
    let trash = dir.join(".gus-trash");
    std::fs::create_dir_all(&trash).expect("trash");

    let ahora = now_ms();
    let dia: u64 = 24 * 60 * 60 * 1_000;

    let caducada = trash.join("vieja.md");
    let limite = trash.join("limite.md");
    let vigente = trash.join("reciente.md");
    std::fs::write(&caducada, "vieja").expect("write vieja");
    std::fs::write(&limite, "limite").expect("write limite");
    std::fs::write(&vigente, "hola").expect("write reciente");

    save_trash_manifest(
        &trash,
        &[
            TrashRecord {
                name: "vieja.md".into(),
                origin: dir.join("vieja.md").to_string_lossy().into_owned(),
                trashed_at_ms: ahora - 31 * dia,
            },
            TrashRecord {
                name: "limite.md".into(),
                origin: dir.join("limite.md").to_string_lossy().into_owned(),
                trashed_at_ms: ahora - 30 * dia,
            },
            TrashRecord {
                name: "reciente.md".into(),
                origin: dir.join("reciente.md").to_string_lossy().into_owned(),
                trashed_at_ms: ahora - 5 * dia,
            },
        ],
    )
    .expect("manifest");

    let purgados = purge_expired_trash(&trash);
    assert_eq!(purgados, 2, "vencen las de 31 días y la de justo 30");
    assert!(!caducada.exists(), "la de 31 días se fue para siempre");
    assert!(!limite.exists(), "la de 30 días exactos también");
    assert!(vigente.exists(), "la de 5 días sigue entera");

    let restantes = load_trash_manifest(&trash);
    assert_eq!(restantes.len(), 1, "solo queda el registro vigente");
    assert_eq!(restantes[0].name, "reciente.md");

    let carpeta = trash.join("viajes");
    std::fs::create_dir_all(carpeta.join("fotos")).expect("subdir");
    std::fs::write(carpeta.join("fotos").join("paris.md"), "x").expect("write");
    let mut registros = load_trash_manifest(&trash);
    registros.push(TrashRecord {
        name: "viajes".into(),
        origin: dir.join("viajes").to_string_lossy().into_owned(),
        trashed_at_ms: ahora - 40 * dia,
    });
    save_trash_manifest(&trash, &registros).expect("manifest 2");

    assert_eq!(purge_expired_trash(&trash), 1);
    assert!(!carpeta.exists(), "la carpeta caducada se va entera");
    assert!(vigente.exists(), "lo vigente no se toca");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn purge_respeta_lo_sin_fecha_y_limpia_registros_basura() {
    let dir = temp_vault("trash-ttl-guard");
    let trash = dir.join(".gus-trash");
    std::fs::create_dir_all(&trash).expect("trash");

    let huerfana = trash.join("sin-fecha.md");
    std::fs::write(&huerfana, "?").expect("write");

    save_trash_manifest(
        &trash,
        &[TrashRecord {
            name: "../fuera.md".into(),
            origin: dir.join("fuera.md").to_string_lossy().into_owned(),
            trashed_at_ms: now_ms() - 40 * 24 * 60 * 60 * 1_000,
        }],
    )
    .expect("manifest");

    assert_eq!(purge_expired_trash(&trash), 0, "no se borró nada del disco");
    assert!(huerfana.exists(), "sin fecha no se caduca");
    assert!(
        load_trash_manifest(&trash).is_empty(),
        "el registro basura se fue"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn move_vault_file_entra_en_la_carpeta() {
    let dir = temp_vault("crud-move");
    let destino = dir.join("archivadas");
    std::fs::create_dir(&destino).expect("mkdir");
    let destino = destino.to_string_lossy().into_owned();

    let origen = dir.join("vieja.md");
    std::fs::write(&origen, "contenido").expect("write");
    let origen = origen.to_string_lossy().into_owned();

    let moved = move_vault_file(origen.clone(), destino.clone()).expect("debe moverse");
    assert!(!std::path::Path::new(&origen).exists());
    assert_eq!(moved, std::path::Path::new(&destino).join("vieja.md"));
    assert_eq!(std::fs::read_to_string(&moved).expect("read"), "contenido");

    std::fs::write(&origen, "2").expect("write");
    let moved_again = move_vault_file(origen.clone(), destino.clone()).expect("debe moverse");
    assert!(moved_again.ends_with("vieja-2.md"), "ruta = {moved_again}");
    assert_eq!(std::fs::read_to_string(&moved).expect("read"), "contenido");

    let before = moved.clone();
    let moved = move_vault_file(moved, destino.clone()).expect("no debe fallar");
    assert_eq!(moved, before, "mover a la misma carpeta no debe cambiar la ruta");
    assert!(std::path::Path::new(&moved_again).exists());

    let missing = dir.join("no-existe").to_string_lossy().into_owned();
    let err = move_vault_file(moved_again, missing).expect_err("el destino no existe");
    assert!(err.contains("destino"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_vault_entries_ordena_carpetas_primero_y_filtra() {
    let dir = temp_vault("crud-list");
    std::fs::write(dir.join("b-nota.md"), "").expect("write md");
    std::fs::write(dir.join("a-nota.md"), "").expect("write md");
    std::fs::write(dir.join("imagen.png"), [1, 2, 3]).expect("write png");
    std::fs::write(dir.join("manual.pdf"), "%PDF-1.4").expect("write pdf");
    std::fs::write(dir.join("datos.txt"), "x").expect("write txt");
    std::fs::write(dir.join(".oculta.md"), "").expect("write oculta");
    std::fs::create_dir(dir.join("zz-carpeta")).expect("mkdir");
    std::fs::create_dir(dir.join(".git")).expect("mkdir");

    let entries = list_vault_entries(dir.to_string_lossy().into_owned())
        .expect("debe listarse");
    let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
    assert_eq!(
        names,
        ["zz-carpeta", "a-nota.md", "b-nota.md", "imagen.png", "manual.pdf"]
    );
    assert!(entries[0].is_dir);
    assert!(!entries[1].is_dir);
    assert!(entries[1].modified_ms.is_some());

    let missing = dir.join("recien-creada");
    let created = list_vault_entries(missing.to_string_lossy().into_owned())
        .expect("create and read");
    assert!(created.is_empty());
    assert!(missing.is_dir());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_vault_dirs_es_recursivo_y_relativo() {
    let dir = temp_vault("crud-dirs");
    std::fs::create_dir_all(dir.join("trabajo/urgente")).expect("mkdir");
    std::fs::create_dir(dir.join("personal")).expect("mkdir");
    std::fs::create_dir(dir.join(".oculta")).expect("mkdir");
    std::fs::write(dir.join("archivo.md"), "").expect("write");

    let dirs = list_vault_dirs(dir.to_string_lossy().into_owned()).expect("debe listarse");
    let relatives: Vec<&str> = dirs.iter().map(|entry| entry.relative.as_str()).collect();
    assert_eq!(relatives, ["personal", "trabajo", "trabajo/urgente"]);

    let missing = dir.join("no-existe").to_string_lossy().into_owned();
    assert!(list_vault_dirs(missing).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rename_vault_dir_renombra_sin_pisar() {
    let dir = temp_vault("dir-rename");
    std::fs::create_dir(dir.join("vieja")).expect("mkdir");

    let renamed = rename_vault_dir(
        dir.join("vieja").to_string_lossy().into_owned(),
        dir.join("nueva").to_string_lossy().into_owned(),
    )
    .expect("debe renombrarse");
    assert!(std::path::Path::new(&renamed).is_dir());
    assert!(!dir.join("vieja").exists());
    assert!(dir.join("nueva").is_dir());

    let err = rename_vault_dir(
        dir.join("nueva").to_string_lossy().into_owned(),
        dir.join("nueva/hija").to_string_lossy().into_owned(),
    )
    .expect_err("una carpeta no puede contenerse");
    assert!(err.contains("dentro de sí misma"), "mensaje = {err}");
    assert!(dir.join("nueva").is_dir());

    std::fs::create_dir(dir.join("ocupada")).expect("mkdir");
    std::fs::create_dir(dir.join("tambien")).expect("mkdir");
    let err = rename_vault_dir(
        dir.join("tambien").to_string_lossy().into_owned(),
        dir.join("ocupada").to_string_lossy().into_owned(),
    )
    .expect_err("el destino ya existe");
    assert!(err.contains("Ya existe"), "mensaje = {err}");

    let destino = dir.join("contenedor");
    std::fs::create_dir(&destino).expect("mkdir destino");
    let movida = rename_vault_dir(
        dir.join("nueva").to_string_lossy().into_owned(),
        destino.join("movida").to_string_lossy().into_owned(),
    )
    .expect("debe mover la carpeta");
    assert!(std::path::Path::new(&movida).is_dir());
    assert_eq!(movida, destino.join("movida").to_string_lossy());
    assert!(!dir.join("nueva").exists());

    let err = rename_vault_dir(
        dir.join("fantasma").to_string_lossy().into_owned(),
        dir.join("otra").to_string_lossy().into_owned(),
    )
    .expect_err("no existe la carpeta origen");
    assert!(err.contains("No existe"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn delete_vault_dir_borra_en_carpetas_y_no_la_raiz() {
    let dir = temp_vault("dir-delete");
    let target = dir.join("temporal");
    std::fs::create_dir_all(target.join("anidada")).expect("mkdir");
    std::fs::write(target.join("anidada/nota.md"), "x").expect("write");

    delete_vault_dir(target.to_string_lossy().into_owned()).expect("debe eliminarse");
    assert!(!target.exists());

    let err =
        delete_vault_dir(dir.join("no-existe").to_string_lossy().into_owned())
            .expect_err("no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");

    let file = dir.join("archivo.md");
    std::fs::write(&file, "").expect("write file");
    let err = delete_vault_dir(file.to_string_lossy().into_owned()).expect_err("es un archivo");
    assert!(err.contains("No existe"), "mensaje = {err}");

    assert!(delete_vault_dir("/".to_string()).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn base64_codifica_vectores_conocidos() {
    assert_eq!(base64_encode(b""), "");
    assert_eq!(base64_encode(b"M"), "TQ==");
    assert_eq!(base64_encode(b"Ma"), "TWE=");
    assert_eq!(base64_encode(b"Man"), "TWFu");
    assert_eq!(base64_encode(b"abcd"), "YWJjZA==");
    assert_eq!(base64_encode(&[0xFF, 0xFE, 0xFD]), "//79");
}

#[test]
fn read_vault_image_devuelve_data_url() {
    let dir = temp_vault("img-read");
    let png = dir.join("foto.png");
    std::fs::write(&png, b"Man").expect("write png");

    let url = read_vault_image(png.to_string_lossy().into_owned()).expect("debe leerse");
    assert_eq!(url, "data:image/png;base64,TWFu");

    std::fs::write(dir.join("a.JPG"), b"Ma").expect("write jpg");
    assert_eq!(
        read_vault_image(dir.join("a.JPG").to_string_lossy().into_owned()).expect("jpg"),
        "data:image/jpeg;base64,TWE="
    );

    std::fs::write(dir.join("d.txt"), b"Man").expect("write txt");
    let err = read_vault_image(dir.join("d.txt").to_string_lossy().into_owned())
        .expect_err("no es imagen");
    assert!(err.contains("solo imágenes"), "mensaje = {err}");

    let err = read_vault_image(dir.join("no-existe.png").to_string_lossy().into_owned())
        .expect_err("no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn list_vault_images_busca_en_carpetas_y_ordena_por_fecha() {
    let dir = temp_vault("images-list");
    std::fs::create_dir(dir.join("adjuntos")).expect("mkdir adjuntos");
    std::fs::create_dir(dir.join(".oculta")).expect("mkdir oculta");

    std::fs::write(dir.join("raiz.png"), [1]).expect("png");
    std::fs::write(dir.join("adjuntos").join("foto.jpg"), [1]).expect("jpg");
    std::fs::write(dir.join("nota.md"), "# hola").expect("md");
    std::fs::write(dir.join("manual.pdf"), "%PDF-1.4").expect("pdf");
    std::fs::write(dir.join(".oculta").join("secreta.png"), [1]).expect("oculta");

    // La fecha manda: la de la carpeta es la más reciente.
    let tocar = |ruta: std::path::PathBuf, hace_segundos: u64| {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&ruta)
            .expect("open mtime");
        file.set_modified(
            std::time::SystemTime::now() - std::time::Duration::from_secs(hace_segundos),
        )
        .expect("set mtime");
    };
    tocar(dir.join("raiz.png"), 7200);
    tocar(dir.join("adjuntos").join("foto.jpg"), 60);

    let images = list_vault_images(dir.to_string_lossy().into_owned()).expect("lista");
    let relativas: Vec<&str> = images
        .iter()
        .map(|image| image.relative.as_str())
        .collect();

    // Solo imágenes: ni notas, ni PDF, ni la carpeta oculta.
    assert_eq!(relativas, ["adjuntos/foto.jpg", "raiz.png"]);
    assert_eq!(images[0].name, "foto.jpg");
    assert!(images[0].path.ends_with("foto.jpg"));
    assert!(images[0].modified_ms.is_some());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_vault_image_thumb_reduce_la_imagen() {
    let dir = temp_vault("img-thumb");
    let ruta = dir.join("foto.png");

    let original = image::RgbaImage::from_fn(200, 100, |x, y| {
        image::Rgba([x as u8, y as u8, 64, 255])
    });
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(original)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("png");
    std::fs::write(&ruta, &png).expect("write");

    let thumb =
        read_vault_image_thumb(ruta.to_string_lossy().into_owned(), 64).expect("miniatura");
    assert!(thumb.starts_with("data:image/png;base64,"), "url = {thumb}");

    let bytes = decode_base64(thumb.trim_start_matches("data:image/png;base64,"))
        .expect("base64 válido");
    let reducida = image::load_from_memory(&bytes).expect("miniatura decodificable");
    // 200×100 con lado máximo 64: baja a 64×32 sin cambiar la proporción.
    assert_eq!((reducida.width(), reducida.height()), (64, 32));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_vault_image_thumb_explica_lo_que_no_se_puede_reducir() {
    let dir = temp_vault("img-thumb-err");

    let err = read_vault_image_thumb(dir.join("nota.md").to_string_lossy().into_owned(), 64)
        .expect_err("no es imagen");
    assert!(err.contains("solo imágenes"), "mensaje = {err}");

    std::fs::write(dir.join("rota.png"), b"no soy un png").expect("write");
    let err = read_vault_image_thumb(dir.join("rota.png").to_string_lossy().into_owned(), 64)
        .expect_err("no decodifica");
    assert!(err.contains("No se pudo reducir"), "mensaje = {err}");

    let err =
        read_vault_image_thumb(dir.join("fantasma.png").to_string_lossy().into_owned(), 64)
            .expect_err("no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_vault_pdf_devuelve_data_url() {
    let dir = temp_vault("pdf-read");
    let pdf = dir.join("clase.pdf");
    std::fs::write(&pdf, b"Man").expect("write pdf");

    let url = read_vault_pdf(pdf.to_string_lossy().into_owned()).expect("debe leerse");
    assert_eq!(url, "data:application/pdf;base64,TWFu");

    std::fs::write(dir.join("a.PDF"), b"Ma").expect("write pdf mayúsculas");
    assert_eq!(
        read_vault_pdf(dir.join("a.PDF").to_string_lossy().into_owned()).expect("PDF"),
        "data:application/pdf;base64,TWE="
    );

    std::fs::write(dir.join("d.txt"), b"Man").expect("write txt");
    let err = read_vault_pdf(dir.join("d.txt").to_string_lossy().into_owned())
        .expect_err("no es pdf");
    assert!(err.contains("solo PDF"), "mensaje = {err}");

    let err = read_vault_pdf(dir.join("no-existe.pdf").to_string_lossy().into_owned())
        .expect_err("no existe");
    assert!(err.contains("No existe"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_vault_image_rechaza_archivos_gigantes() {
    let dir = temp_vault("img-big");
    let big = dir.join("gigante.png");

    let file = std::fs::File::create(&big).expect("create");
    file.set_len(31 * 1024 * 1024).expect("set_len");
    drop(file);

    let err =
        read_vault_image(big.to_string_lossy().into_owned()).expect_err("demasiado grande");
    assert!(err.contains("30 MB"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn crud_de_archivos_tambien_funciona_en_imagenes() {
    let dir = temp_vault("crud-img-entry");
    let img = dir.join("foto.png");
    std::fs::write(&img, b"x").expect("write png");

    let renamed = rename_vault_file(
        img.to_string_lossy().into_owned(),
        dir.join("playa.png").to_string_lossy().into_owned(),
    )
    .expect("debe renombrarse");
    assert!(renamed.ends_with("playa.png"), "ruta = {renamed}");
    assert!(std::path::Path::new(&renamed).is_file());

    let sub = dir.join("viajes");
    std::fs::create_dir(&sub).expect("mkdir");
    let moved = move_vault_file(renamed, sub.to_string_lossy().into_owned())
        .expect("debe moverse");
    assert!(std::path::Path::new(&moved).is_file());

    delete_vault_file(moved.clone()).expect("debe borrarse");
    assert!(!std::path::Path::new(&moved).exists());

    let csv = dir.join("datos.csv");
    std::fs::write(&csv, "a,b").expect("write csv");
    let err = delete_vault_file(csv.to_string_lossy().into_owned()).expect_err("csv");
    assert!(err.contains(".md"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn app_config_roundtrip_y_default() {
    let dir = temp_vault("app-config");
    let path = dir.join("config.json");

    assert_eq!(load_config_from(&path), AppConfig::default());

    let config = AppConfig {
        base_dir: Some("~/Documents/gus-vaults".into()),
        vaults: vec![
            VaultInfo {
                name: "Diario".into(),
                path: "~/Documents/gus-vaults/Diario".into(),
                cover: None,
            },
            VaultInfo {
                name: "Trabajo".into(),
                path: "~/Documents/gus-vaults/Trabajo".into(),
                cover: Some("~/Pictures/trabajo.png".into()),
            },
        ],
        last_vault: Some("~/Documents/gus-vaults/Diario".into()),
        settings: AppSettings::default(),
    };

    save_config_to(&path, &config).expect("debe guardarse");
    assert_eq!(load_config_from(&path), config);

    let raw = std::fs::read_to_string(&path).expect("raw");
    assert!(raw.contains("baseDir"), "raw = {raw}");
    assert!(raw.contains("lastVault"), "raw = {raw}");

    std::fs::write(&path, "no-es-json{{").expect("corrupt");
    assert_eq!(load_config_from(&path), AppConfig::default());

    assert!(
        default_vaults_base().ends_with("Documents/gus-vaults"),
        "base = {}",
        default_vaults_base()
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn app_settings_se_normalizan_al_cargar() {
    let dir = temp_vault("app-settings");
    let path = dir.join("config.json");

    std::fs::write(
        &path,
        r#"{"baseDir":"~/vaults","vaults":[],"lastVault":null}"#,
    )
    .expect("raw");
    let legacy = load_config_from(&path);
    assert_eq!(legacy.settings, AppSettings::default());
    assert!(legacy.settings.open_last_vault);
    assert!(legacy.settings.animations);
    assert_eq!(legacy.settings.accent, "terracota");
    assert_eq!(legacy.settings.editor_font_size, 14);
    assert_eq!(legacy.settings.spell_langs, vec!["es".to_string()]);
    assert!(legacy.settings.spell_words.is_empty());

    let custom = AppConfig {
        settings: AppSettings {
            open_last_vault: false,
            animations: false,
            accent: "menta".into(),
            editor_font_size: 18,
            auto_save: false,
            hide_completed_tasks: true,
            spell_langs: vec!["de".into(), "fr".into()],
            spell_words: vec!["Gus".into(), "Tauri".into()],
            ..AppSettings::default()
        },
        ..AppConfig::default()
    };
    save_config_to(&path, &custom).expect("guarda");
    assert_eq!(load_config_from(&path), custom);

    std::fs::write(
        &path,
        r#"{
          "baseDir": null,
          "vaults": [],
          "lastVault": null,
          "settings": { "accent": "neon", "editorFontSize": 240,
                         "spellLangs": ["de", "xx", "de", "off"],
                         "spellWords": ["  Gus  ", "", "Gus", "Tauri"] }
        }"#,
    )
    .expect("raw");
    let saned = load_config_from(&path);
    assert_eq!(saned.settings.accent, "terracota");
    assert_eq!(saned.settings.editor_font_size, 22);
    // Los diccionarios que no existen y las repeticiones se descartan; la
    // lista vacía sí es válida (corrector apagado).
    assert_eq!(saned.settings.spell_langs, vec!["de".to_string()]);
    assert_eq!(saned.settings.spell_words, vec!["Gus", "Tauri"]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn task_store_es_un_json_oculto_y_persiste_tareas() {
    let dir = temp_vault("task-store");

    assert_eq!(
        load_tasks(dir.to_string_lossy().into_owned()).expect("load inicial"),
        Vec::<StoredTask>::new()
    );

    let tasks = vec![StoredTask {
        id: "task-1".into(),
        title: "Comprar pan".into(),
        tags: vec!["casa".into()],
        completes: false,
        description: Some("Antes de las ocho".into()),
        due: Some("2026-09-30".into()),
        priority: None,
        doing: false,
    }];

    save_tasks(dir.to_string_lossy().into_owned(), tasks.clone()).expect("debe guardarse");
    assert_eq!(
        load_tasks(dir.to_string_lossy().into_owned()).expect("debe recargarse"),
        tasks
    );

    let path = dir.join(TASK_STORE_FILE);
    assert!(path.is_file(), "el almacén debe ser {TASK_STORE_FILE}");
    let raw = std::fs::read_to_string(&path).expect("raw");
    assert!(raw.contains("\"version\": 1"), "raw = {raw}");
    assert!(raw.contains("\"completes\": false"), "raw = {raw}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn migracion_lee_y_archiva_tareas_markdown() {
    let dir = temp_vault("task-migrate");

    assert!(
        !read_legacy_tasks(dir.to_string_lossy().into_owned())
            .expect("legacy inicial")
            .is_some()
    );
    assert!(!archive_legacy_tasks(dir.to_string_lossy().into_owned())
        .expect("archive sin origen"));

    let legacy = dir.join(LEGACY_TASKS_FILE);
    std::fs::write(&legacy, "- [ ] Llamar al doctor 2026-10-01\n").expect("legacy");
    let markdown =
        read_legacy_tasks(dir.to_string_lossy().into_owned()).expect("legacy leído");
    assert!(markdown.expect("contiene tareas").contains("Llamar"));

    assert!(archive_legacy_tasks(dir.to_string_lossy().into_owned()).expect("archivado"));
    assert!(!legacy.exists());
    let archived = dir.join(".gus-tasks.md.bak");
    assert!(archived.is_file(), "respaldo oculto = {}", archived.display());

    assert!(!archive_legacy_tasks(dir.to_string_lossy().into_owned())
        .expect("ya archivado"));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn create_vault_crea_dir_y_bienvenida_sin_pisar() {
    let base = temp_vault("vault-create");

    let created = create_vault(
        base.to_string_lossy().into_owned(),
        "Diario".into(),
    )
    .expect("debe crearse");
    assert!(std::path::Path::new(&created).is_dir());
    assert!(created.ends_with("Diario"));

    let welcome = std::fs::read_to_string(std::path::Path::new(&created).join("Bienvenido.md"))
        .expect("nota de bienvenida");
    assert!(welcome.contains("# Bienvenido"), "welcome = {welcome}");
    assert!(welcome.contains("- [ ]"), "welcome = {welcome}");

    let deep = base.join("otra-base");
    let created = create_vault(
        deep.to_string_lossy().into_owned(),
        "Anidado".into(),
    )
    .expect("debe crearse con base nueva");
    assert!(std::path::Path::new(&created).is_dir());

    let err = create_vault(base.to_string_lossy().into_owned(), "Diario".into())
        .expect_err("ya existe");
    assert!(err.contains("Ya existe"), "mensaje = {err}");

    let err = create_vault(base.to_string_lossy().into_owned(), "   ".into())
        .expect_err("vacío");
    assert!(err.contains("nombre"), "mensaje = {err}");
    assert!(create_vault(base.to_string_lossy().into_owned(), "a/b".into()).is_err());
    assert!(create_vault(base.to_string_lossy().into_owned(), "..".into()).is_err());

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn vault_dir_exists_detecta_solo_carpetas() {
    let dir = temp_vault("vault-exists");

    assert!(vault_dir_exists(dir.to_string_lossy().into_owned()));

    let file = dir.join("nota.md");
    std::fs::write(&file, "").expect("write");
    assert!(!vault_dir_exists(file.to_string_lossy().into_owned()), "un archivo no cuenta");

    assert!(!vault_dir_exists(dir.join("fantasma").to_string_lossy().into_owned()));

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn nueva_tarea_se_valida_y_normaliza() {
    let err = validate_new_task(NewTask {
        title: "   ".into(),
        description: None,
        tags: vec![],
        due: None,
        priority: None,
    })
    .expect_err("sin nombre");
    assert!(err.contains("nombre"), "mensaje = {err}");

    let task = validate_new_task(NewTask {
        title: "  Comprar pan  ".into(),
        description: Some("  ".into()),
        tags: vec!["casa".into()],
        due: Some(String::new()),
        priority: None,
    })
    .expect("debe ser válida");
    assert_eq!(task.title, "Comprar pan");
    assert_eq!(task.description, None);
    assert_eq!(task.due, None);
    assert_eq!(task.tags, ["casa"]);
    assert_eq!(task.priority, None);

    let task = validate_new_task(NewTask {
        title: "X".into(),
        description: Some("Detalle.".into()),
        tags: vec![],
        due: Some("2026-10-15".into()),
        priority: Some(TaskPriority::Alta),
    })
    .expect("fecha correcta");
    assert_eq!(task.due.as_deref(), Some("2026-10-15"));
    assert_eq!(task.description.as_deref(), Some("Detalle."));
    assert_eq!(task.priority, Some(TaskPriority::Alta));

    let err = validate_new_task(NewTask {
        title: "X".into(),
        description: None,
        tags: vec![],
        due: Some("15/10/2026".into()),
        priority: None,
    })
    .expect_err("formato raro");
    assert!(err.contains("Fecha"), "mensaje = {err}");
}

#[test]
fn nueva_tarea_desde_json_tolera_campos_ausentes() {
    let task: NewTask = serde_json::from_str(r#"{"title":"Solo nombre"}"#).expect("json");
    assert_eq!(task.title, "Solo nombre");
    assert_eq!(task.description, None);
    assert!(task.tags.is_empty());
    assert_eq!(task.due, None);
    assert_eq!(task.priority, None);
}

#[test]
fn task_store_lee_prioridad_sin_cambiar_los_archivos_antiguos() {
    let dir = temp_vault("task-priority");

    std::fs::write(
        dir.join(TASK_STORE_FILE),
        r#"{"version":1,"tasks":[{"id":"t1","title":"Tarea antigua"}]}"#,
    )
    .expect("raw antiguo");
    let legacy = load_tasks(dir.to_string_lossy().into_owned()).expect("load antiguo");
    assert_eq!(legacy.len(), 1);
    assert_eq!(legacy[0].priority, None);
    assert!(!legacy[0].doing);

    let tasks = vec![StoredTask {
        id: "t2".into(),
        title: "Enviar el informe".into(),
        tags: vec!["trabajo".into()],
        completes: false,
        description: None,
        due: None,
        priority: Some(TaskPriority::Urgente),
        doing: true,
    }];
    save_tasks(dir.to_string_lossy().into_owned(), tasks.clone()).expect("save");
    assert_eq!(
        load_tasks(dir.to_string_lossy().into_owned()).expect("reload"),
        tasks
    );

    let raw = std::fs::read_to_string(dir.join(TASK_STORE_FILE)).expect("raw");
    assert!(raw.contains("\"priority\": \"urgente\""), "raw = {raw}");
    assert!(raw.contains("\"doing\": true"), "raw = {raw}");

    std::fs::write(
        dir.join(TASK_STORE_FILE),
        r#"{"version":1,"tasks":[{"id":"t3","title":"Sin bandera","tags":[],"completes":false,"priority":null,"doing":false}]}"#,
    )
    .expect("raw con null");
    let tasks = load_tasks(dir.to_string_lossy().into_owned()).expect("load con null");
    assert_eq!(tasks[0].priority, None);

    std::fs::write(
        dir.join(TASK_STORE_FILE),
        r#"{"version":1,"tasks":[{"id":"t4","title":"Rara","priority":"media-alta"}]}"#,
    )
    .expect("raw rara");
    let err = load_tasks(dir.to_string_lossy().into_owned())
        .expect_err("prioridad desconocida");
    assert!(err.contains("unknown variant"), "mensaje = {err}");
    assert!(err.contains("urgente"), "mensaje = {err}");

    std::fs::remove_dir_all(&dir).ok();
}

/// El grafo del vault trae una entrada por nota, con etiquetas y enlaces.
#[test]
fn construye_el_grafo_de_enlaces_del_vault() {
    let vault = temp_vault("grafo");
    std::fs::write(
        vault.join("Una.md"),
        "# Una\n\nEnlace a [[Dos|segunda]] y [[Dos]].\n",
    )
    .expect("write note");
    std::fs::write(
        vault.join("Dos.md"),
        "---\ntags: [clases]\n---\n\nVuelvo a [[Una]]\n",
    )
    .expect("write note");

    let graph = build_link_graph(vault.to_string_lossy().into_owned()).expect("graph");
    assert_eq!(graph.nodes.len(), 2);

    let una = graph.nodes.iter().find(|node| node.relative == "Una.md").expect("Una");
    assert_eq!(una.links.len(), 1);
    assert_eq!(una.links[0].target, "Dos");
    assert_eq!(una.links[0].count, 2);

    let dos = graph.nodes.iter().find(|node| node.relative == "Dos.md").expect("Dos");
    assert_eq!(dos.tags, vec!["clases".to_string()]);
    assert_eq!(dos.links[0].target, "Una");

    std::fs::remove_dir_all(&vault).ok();
}

/// El título es el primer encabezado que no está en el frontmatter.
#[test]
fn el_titulo_de_la_nota_es_el_primer_encabezado() {
    assert_eq!(
        note_title("# Apuntes de la clase\n\ntexto\n", "nota.md"),
        "Apuntes de la clase"
    );
    assert_eq!(
        note_title("---\ntitle: Otra cosa\n---\n\n# La buena\ntexto\n", "nota.md"),
        "La buena"
    );
    // Sin encabezado se queda con el nombre del archivo, sin extensión.
    assert_eq!(note_title("texto suelto\n", "Receta de pan.md"), "Receta de pan");
    // Un encabezado de otro nivel también vale: lo que no vale es prosa.
    assert_eq!(note_title("## subsección\n\ntexto\n", "x.md"), "subsección");
    // Un frontmatter sin cerrar no es frontmatter: no se salta nada.
    assert_eq!(note_title("---\nsin cerrar\n# Esto cuenta\n", "y.md"), "y");
}

/// La búsqueda compara sin mayúsculas y devuelve desplazamientos reales.
#[test]
fn localiza_los_terminos_sin_distinguir_mayusculas() {
    let claves = vec!["clase".to_string()];
    assert_eq!(term_ranges("La CLASE de hoy", &claves), vec![(3, 8)]);

    // Varias apariciones, en orden, sin solaparse entre sí.
    assert_eq!(term_ranges("ana banana", &["ana".into()]), vec![(0, 3), (5, 8)]);

    // Dos términos: cada uno aporta su rango.
    let varios = term_ranges("gato perro gato", &["gato".into(), "perro".into()]);
    assert_eq!(varios, vec![(0, 4), (5, 10), (11, 15)]);

    // Un término que no está no deja rango.
    assert!(term_ranges("hola", &["adios".into()]).is_empty());
}

/// El fragmento marca solo los aciertos y recorta líneas largas.
#[test]
fn trocea_el_fragmento_en_aciertos_y_contexto() {
    let ranges = term_ranges("El dato importante es el dato", &["dato".into()]);
    let segments = snippet_segments("El dato importante es el dato", &ranges);

    assert_eq!(
        segments.iter().filter(|segment| segment.hit).count(),
        2,
        "las dos apariciones han de salir marcadas"
    );
    // El texto troceado, vuelto a unir, es la línea original.
    let rebuilt: String = segments.iter().map(|segment| segment.text.as_str()).collect();
    assert_eq!(rebuilt, "El dato importante es el dato");

    // Una línea enorme se recorta con puntos suspensivos a ambos lados.
    let long = format!("{} DATO {}", "a".repeat(400), "b".repeat(400));
    let long_ranges = term_ranges(&long, &["dato".into()]);
    let long_segments = snippet_segments(&long, &long_ranges);
    let long_text: String = long_segments.iter().map(|segment| segment.text.as_str()).collect();
    assert!(long_text.len() < long.len(), "el fragmento ha de recortarse");
    assert!(long_text.starts_with('…') && long_text.ends_with('…'));
    assert!(long_segments.iter().any(|segment| segment.hit));
}

/// El índice se construye, se guarda como JSON y se vuelve a leer.
#[test]
fn construye_y_vuelve_a_leer_el_indice() {
    let vault = temp_vault("indice");
    std::fs::write(
        vault.join("Recetas.md"),
        "# Recetas de pan\n\nHarina, agua y sal.\n",
    )
    .expect("write note");
    std::fs::create_dir_all(vault.join("Trabajo")).expect("mkdir");
    std::fs::write(
        vault.join("Trabajo").join("Plan.md"),
        "---\ntags: [urgente]\n---\n\n# Plan trimestral\nRevisar el presupuesto.\n",
    )
    .expect("write note");

    let stats = build_search_index(vault.to_string_lossy().into_owned()).expect("index");
    assert_eq!(stats.notes, 2);
    assert_eq!(stats.added, 2);
    assert!(vault.join(INDEX_DIR).join("index.json").is_file());

    // Reconstruir sin cambios no vuelve a leer nada: todo se reutiliza.
    let again = build_search_index(vault.to_string_lossy().into_owned()).expect("index");
    assert_eq!(again.reused, 2);
    assert_eq!(again.added + again.updated, 0);

    // El índice no se lleva las carpetas ocultas ni lo que no sea .md.
    std::fs::write(vault.join("no-es-nota.txt"), "basura").expect("write txt");
    let third = build_search_index(vault.to_string_lossy().into_owned()).expect("index");
    assert_eq!(third.notes, 2);
    assert_eq!(third.removed, 0);

    std::fs::remove_dir_all(&vault).ok();
}

/// La búsqueda encuentra por el interior de la nota, resalta y filtra.
#[test]
fn busca_dentro_de_las_notas_y_filtra() {
    let vault = temp_vault("busca");
    std::fs::create_dir_all(vault.join("Clases")).expect("mkdir");
    std::fs::write(
        vault.join("Clases").join("Historia.md"),
        "# Historia de España\n\nLa Revolución Industrial empezó en Inglaterra.\n",
    )
    .expect("write note");
    std::fs::write(
        vault.join("Cocina.md"),
        "# Cocina\n\nLa masa madre fermenta durante horas.\n",
    )
    .expect("write note");

    build_search_index(vault.to_string_lossy().into_owned()).expect("index");
    let root = vault.to_string_lossy().into_owned();

    // Coincide por el contenido, no solo por el nombre del archivo.
    let results = search_notes(root.clone(), "industrial".into(), SearchFilters::default())
        .expect("search");
    assert_eq!(results.total, 1);
    let hit = &results.matches[0];
    assert_eq!(hit.path, "Clases/Historia.md");
    assert_eq!(hit.folder, "Clases");
    assert!(hit.snippets.len() >= 1);
    assert!(hit.snippets[0].segments.iter().any(|segment| segment.hit));

    // Varios términos: todos han de estar (Y), sin distinguir mayúsculas.
    let both = search_notes(root.clone(), "REVOLUCIÓN inglaterra".into(), SearchFilters::default())
        .expect("search");
    assert_eq!(both.total, 1);
    let impossible = search_notes(root.clone(), "revolución cohete".into(), SearchFilters::default())
        .expect("search");
    assert_eq!(impossible.total, 0);

    // Sin términos no se devuelve nada.
    let blank = search_notes(root.clone(), "   ".into(), SearchFilters::default()).expect("search");
    assert_eq!(blank.total, 0);

    // Filtro por carpeta: incluye las subcarpetas y se queda con lo de ahí.
    let folder = search_notes(
        root.clone(),
        "la".into(),
        SearchFilters {
            folder: "Clases".into(),
            ..SearchFilters::default()
        },
    )
    .expect("search");
    assert!(folder.matches.iter().all(|item| item.folder == "Clases"));
    assert_eq!(folder.total, 1);

    // Filtro por etiqueta: solo la nota etiquetada pasa. Se reindexa por
    // el camino incremental, que es el que usa la app al editar.
    update_index_note(
        root.clone(),
        "Clases/Historia.md".into(),
        "---\ntags: [examen]\n---\n\n# Historia de España\n\nLa Revolución Industrial empezó en Inglaterra.\n".into(),
        now_ms() + 5,
    )
    .expect("update");
    let tagged = search_notes(
        root.clone(),
        "industrial".into(),
        SearchFilters {
            tags: vec!["examen".into()],
            ..SearchFilters::default()
        },
    )
    .expect("search");
    assert_eq!(tagged.total, 1);
    let untagged = search_notes(
        root.clone(),
        "industrial".into(),
        SearchFilters {
            tags: vec!["otracosa".into()],
            ..SearchFilters::default()
        },
    )
    .expect("search");
    assert_eq!(untagged.total, 0);

    // Filtro por fecha: en el futuro no hay nada.
    let future = search_notes(
        root.clone(),
        "industrial".into(),
        SearchFilters {
            modified_after_ms: Some(now_ms() + 60_000),
            ..SearchFilters::default()
        },
    )
    .expect("search");
    assert_eq!(future.total, 0);

    std::fs::remove_dir_all(&vault).ok();
}

/// Editar una nota actualiza solo su entrada; borrarla la saca del índice.
#[test]
fn actualiza_y_purga_el_indice_de_forma_incremental() {
    let vault = temp_vault("incremental");
    std::fs::write(vault.join("Nota.md"), "# Nota\n\nprimera version\n").expect("write note");
    std::fs::write(vault.join("Otra.md"), "# Otra\n\nsegunda nota\n").expect("write note");

    let root = vault.to_string_lossy().into_owned();
    build_search_index(root.clone()).expect("index");
    assert_eq!(
        search_notes(root.clone(), "primera".into(), SearchFilters::default())
            .expect("search")
            .total,
        1
    );

    // Se reescribe solo la entrada que cambió.
    let stats = update_index_note(
        root.clone(),
        "Nota.md".into(),
        "# Nota\n\nya no aparece eso\n".into(),
        now_ms() + 1,
    )
    .expect("update");
    assert_eq!(stats.notes, 2);
    assert_eq!(stats.updated, 1);
    assert_eq!(stats.added, 0);

    assert_eq!(
        search_notes(root.clone(), "primera".into(), SearchFilters::default())
            .expect("search")
            .total,
        0
    );
    assert_eq!(
        search_notes(root.clone(), "aparece".into(), SearchFilters::default())
            .expect("search")
            .total,
        1
    );

    // Una nota nueva entra sin tocar a las demás.
    update_index_note(root.clone(), "Tercera.md".into(), "# Tercera\n\ntexto nuevo\n".into(), now_ms())
        .expect("update");
    assert_eq!(
        search_notes(root.clone(), "nuevo".into(), SearchFilters::default())
            .expect("search")
            .total,
        1
    );

    // Al pasar el índice, lo que ya no está en disco se purga.
    let removed = prune_search_index(root.clone(), vec!["Nota.md".into()]).expect("prune");
    assert_eq!(removed, 1);
    let status = search_index_facets(root.clone()).expect("facets");
    assert_eq!(status.notes, 2);
    assert_eq!(
        search_notes(root, "aparece".into(), SearchFilters::default())
            .expect("search")
            .total,
        0
    );

    std::fs::remove_dir_all(&vault).ok();
}

/// Las carpetas y etiquetas del índice alimentan los filtros de la UI.
#[test]
fn expone_las_carpetas_y_etiquetas_para_los_filtros() {
    let vault = temp_vault("facets");
    std::fs::create_dir_all(vault.join("Clases").join("Semana 1")).expect("mkdir");
    std::fs::write(
        vault.join("Clases").join("Semana 1").join("Uno.md"),
        "---\ntags: [examen, importante]\n---\n\n# Uno\n\ntexto\n",
    )
    .expect("write note");
    std::fs::write(vault.join("Clases").join("Dos.md"), "# Dos\n\ntexto\n").expect("write note");
    std::fs::write(vault.join("Suelta.md"), "# Suelto\n\ntexto\n").expect("write note");

    let root = vault.to_string_lossy().into_owned();
    build_search_index(root.clone()).expect("index");
    let facets = search_index_facets(root).expect("facets");

    assert_eq!(facets.notes, 3);
    assert_eq!(facets.folders, vec!["Clases", "Clases/Semana 1"]);
    assert_eq!(facets.tags, vec!["examen", "importante"]);

    std::fs::remove_dir_all(&vault).ok();
}
