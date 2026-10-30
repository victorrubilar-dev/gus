/**
 * Regresión visual: captura las vistas en los dos temas de referencia (oscuro y
 * claro) y las compara píxel a píxel con `bench/linea-base/`. Falla si más del
 * 0,5 % de los píxeles de una captura cambia. Requiere `vite --port 5199`.
 * Uso: `pnpm bench:regresion` · `pnpm bench:regresion --actualizar` (nueva línea base).
 * Las capturas dependen de la fuente del sistema: la línea base es de esta máquina.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMAS = ["gus-oscuro", "gus-claro"];
const UMBRAL = 0.005;
const actualizar = process.argv.includes("--actualizar");
const base = new URL("./linea-base/", import.meta.url).pathname;
const trabajo = join(tmpdir(), `gus-regresion-${process.pid}`);

for (const tema of TEMAS) {
  execFileSync("node", ["bench/capturas.mjs", join(trabajo, tema), tema], { stdio: "inherit" });
}

if (actualizar) {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  cpSync(trabajo, base, { recursive: true });
  console.log(`Línea base actualizada en ${base}`);
  process.exit(0);
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
const b64 = (ruta) => readFileSync(ruta).toString("base64");
let fallos = 0;

for (const tema of TEMAS) {
  if (!existsSync(join(base, tema))) {
    console.log(`FALLA  ${tema}: no hay línea base (ejecuta con --actualizar)`);
    fallos++;
    continue;
  }
  for (const nombre of readdirSync(join(base, tema))) {
    const [a, b] = [join(base, tema, nombre), join(trabajo, tema, nombre)];
    const cambiado = await page.evaluate(async ([x, y]) => {
      const cargar = (d) =>
        new Promise((ok) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            ok(ctx.getImageData(0, 0, c.width, c.height));
          };
          img.src = `data:image/png;base64,${d}`;
        });
      const [p, q] = await Promise.all([cargar(x), cargar(y)]);
      if (p.width !== q.width || p.height !== q.height) return 1;
      let n = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]);
        if (d > 24) n++;
      }
      return n / (p.width * p.height);
    }, [b64(a), b64(b)]);
    const ok = cambiado <= UMBRAL;
    if (!ok) fallos++;
    console.log(`${ok ? "PASA " : "FALLA"}  ${tema}/${nombre}: ${(cambiado * 100).toFixed(2)} % de píxeles distintos`);
  }
}

await browser.close();
rmSync(trabajo, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} captura(s) fuera del umbral`);
process.exit(fallos === 0 ? 0 : 1);
