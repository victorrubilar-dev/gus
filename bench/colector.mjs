/**
 * Colector de la traza del editor de tablas.
 *
 * Escucha en el 5198 y guarda en /tmp/gus-tables.log lo que el editor va
 * contando durante el clic derecho. Sirve para saber qué está pasando de
 * verdad dentro de la app, que es lo que no se puede ver leyendo el código.
 *
 *   node bench/colector.mjs
 */
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const LOG = "/tmp/gus-tables.log";
const PUERTO = 5198;

writeFileSync(LOG, "");
console.log(`Escuchando en http://127.0.0.1:${PUERTO}/log`);
console.log(`La traza se guarda en ${LOG}`);
console.log("Ctrl+C para parar.\n");

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (body) {
      appendFileSync(LOG, body + "\n");
      console.log(body);
    }
    res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    res.end();
  });
}).listen(PUERTO, "127.0.0.1");
