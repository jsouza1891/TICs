// Lee las cotizaciones del dólar de la página del BROU y las guarda en un JSON.
// Lo corre la tarea programada .github/workflows/cotizacion.yml; la app lee el JSON publicado
// en la rama "cotizacion" (raw.githubusercontent.com permite leerlo desde el navegador).
//   node scripts/cotizacion-brou.mjs salida.json [pagina.html]   (con pagina.html no descarga nada: sirve para probar)
import { readFile, writeFile } from 'node:fs/promises';

const URL_BROU = 'https://www.brou.com.uy/cotizaciones';
const [salida = 'cotizacion.json', archivoPrueba] = process.argv.slice(2);

// La tabla tiene una fila por moneda: <p class="moneda">Dólar</p> y después cuatro <p class="valor">:
// compra, venta, arbitraje compra y arbitraje venta, con coma decimal ("38,95000").
function leerFila(html, moneda) {
  const inicio = html.indexOf(`<p class="moneda">${moneda}</p>`);
  if (inicio < 0) return null;
  const fila = html.slice(inicio, html.indexOf('</tr>', inicio));
  const valores = [...fila.matchAll(/<p class="valor">\s*([\d.,]+)\s*<\/p>/g)]
    .map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')));
  const [compra, venta] = valores;
  // control de cordura: si el BROU cambia la página no se publica cualquier cosa
  if (!(compra > 10 && compra < 500 && venta > 10 && venta < 500)) return null;
  return { compra, venta };
}

const html = archivoPrueba
  ? await readFile(archivoPrueba, 'utf8')
  : await (await fetch(URL_BROU, { headers: { 'User-Agent': 'Mozilla/5.0 (TICS APP cotizaciones)' } })).text();
const billete = leerFila(html, 'Dólar');
const ebrou = leerFila(html, 'Dólar eBROU');
if (!billete || !ebrou) {
  console.error('No se encontraron las cotizaciones en la página del BROU', { billete, ebrou });
  process.exit(1);
}

// Si los valores no cambiaron se deja el archivo como estaba (y no se hace un commit nuevo)
let anterior = null;
try { anterior = JSON.parse(await readFile(salida, 'utf8')); } catch { /* primera vez */ }
if (anterior && JSON.stringify([anterior.billete, anterior.ebrou]) === JSON.stringify([billete, ebrou])) {
  console.log('Sin cambios', billete, ebrou);
} else {
  const datos = { fuente: 'BROU', url: URL_BROU, actualizado: new Date().toISOString(), billete, ebrou };
  await writeFile(salida, JSON.stringify(datos, null, 2) + '\n');
  console.log('Cotización nueva', datos);
}
