'use strict';

const CLAVE = 'asistente-personal-v1';
const CATEGORIAS = {
  gasto: ['Comida', 'Transporte', 'Casa', 'Servicios', 'Salud', 'Educación', 'Ocio', 'Ropa', 'Otros'],
  ingreso: ['Sueldo', 'Freelance', 'Ventas', 'Regalo', 'Otros'],
};

// ---------- Datos ----------
function cargar() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE));
    if (d && Array.isArray(d.agenda) && Array.isArray(d.movimientos)) return d;
  } catch (e) { /* almacenamiento no disponible o dañado */ }
  return { agenda: [], movimientos: [] };
}
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)); }
  catch (e) { aviso('No se pudo guardar en este dispositivo'); }
}
const datos = cargar();
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const pad = (n) => String(n).padStart(2, '0');
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseFecha = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
// es-UY agrupa miles también en números de 4 cifras (1.500 y no 1500)
const fmtDinero = (n, dec = 2) => '$' + n.toLocaleString('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtDia = (iso) => parseFecha(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtCorto = (iso) => parseFecha(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function aviso(texto) {
  const t = $('#toast');
  t.textContent = texto;
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 2000);
}

// ---------- Estado de la UI ----------
const ahora = new Date();
let mesActual = { anio: ahora.getFullYear(), mes: ahora.getMonth() }; // mes 0-11
let filtroMov = 'todos';
const TITULOS = { resumen: 'Resumen', agenda: 'Agenda', dinero: 'Dinero' };

const claveMes = () => `${mesActual.anio}-${pad(mesActual.mes + 1)}`;
const enMes = (iso) => iso.startsWith(claveMes());

// ---------- Navegación ----------
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('activo', x === b));
  $$('.vista').forEach((v) => v.classList.toggle('activa', v.id === 'vista-' + b.dataset.vista));
  $('#titulo').textContent = TITULOS[b.dataset.vista];
  // la agenda muestra todo lo pendiente, el selector de mes no aplica
  $('.mes').style.visibility = b.dataset.vista === 'agenda' ? 'hidden' : 'visible';
}));

function cambiarMes(delta) {
  const d = new Date(mesActual.anio, mesActual.mes + delta, 1);
  mesActual = { anio: d.getFullYear(), mes: d.getMonth() };
  render();
}
$('#mesPrev').addEventListener('click', () => cambiarMes(-1));
$('#mesNext').addEventListener('click', () => cambiarMes(1));

// ---------- Agenda ----------
const formAgenda = $('#formAgenda');
formAgenda.fecha.value = hoyISO();
formAgenda.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formAgenda;
  datos.agenda.push({
    id: nuevoId(),
    titulo: f.titulo.value.trim(),
    fecha: f.fecha.value,
    hora: f.hora.value,
    nota: f.nota.value.trim(),
    hecho: false,
  });
  guardar();
  f.titulo.value = ''; f.hora.value = ''; f.nota.value = '';
  aviso('Evento agregado');
  render();
});
$('#verHechos').addEventListener('change', render);

const ordenAgenda = (a, b) => (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99'));

function itemAgenda(ev, conFecha) {
  const sec = [conFecha ? fmtCorto(ev.fecha) : '', ev.hora, ev.nota].filter(Boolean).map(escapar).join(' · ');
  return `<li class="item ${ev.hecho ? 'hecho' : ''}" data-id="${ev.id}">
    <input type="checkbox" class="toggle" ${ev.hecho ? 'checked' : ''} aria-label="Marcar como hecho">
    <div class="info"><div class="principal">${escapar(ev.titulo)}</div>${sec ? `<div class="sec">${sec}</div>` : ''}</div>
    <button class="borrar" data-tipo="agenda" aria-label="Eliminar">✕</button>
  </li>`;
}

function renderAgenda() {
  const verHechos = $('#verHechos').checked;
  const eventos = datos.agenda.filter((e) => verHechos || !e.hecho).sort(ordenAgenda);
  if (!eventos.length) {
    $('#listaAgenda').innerHTML = '<p class="vacio">No hay eventos pendientes 🎉</p>';
    return;
  }
  const hoy = hoyISO();
  let html = '';
  let diaPrevio = null;
  for (const ev of eventos) {
    if (ev.fecha !== diaPrevio) {
      if (diaPrevio !== null) html += '</ul>';
      const etiqueta = ev.fecha === hoy ? 'Hoy' : fmtDia(ev.fecha) + (ev.fecha < hoy ? ' (atrasado)' : '');
      html += `<div class="dia ${ev.fecha === hoy ? 'hoy' : ''}">${etiqueta}</div><ul class="lista">`;
      diaPrevio = ev.fecha;
    }
    html += itemAgenda(ev, false);
  }
  $('#listaAgenda').innerHTML = html + '</ul>';
}

// ---------- Movimientos ----------
const formMov = $('#formMov');
formMov.fecha.value = hoyISO();

function cargarCategorias() {
  const tipo = formMov.tipo.value;
  $('#selCategoria').innerHTML = CATEGORIAS[tipo].map((c) => `<option>${c}</option>`).join('');
}
formMov.querySelectorAll('input[name=tipo]').forEach((r) => r.addEventListener('change', cargarCategorias));
cargarCategorias();

formMov.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formMov;
  const monto = Math.round(parseFloat(f.monto.value) * 100) / 100;
  if (!(monto > 0)) return aviso('Ingresá un monto válido');
  datos.movimientos.push({
    id: nuevoId(),
    tipo: f.tipo.value,
    monto,
    categoria: f.categoria.value,
    fecha: f.fecha.value,
    descripcion: f.descripcion.value.trim(),
  });
  guardar();
  f.monto.value = ''; f.descripcion.value = '';
  aviso(f.tipo.value === 'gasto' ? 'Gasto guardado' : 'Ingreso guardado');
  render();
});

$$('.filtros .chip').forEach((c) => c.addEventListener('click', () => {
  filtroMov = c.dataset.filtro;
  $$('.filtros .chip').forEach((x) => x.classList.toggle('activo', x === c));
  renderMovimientos();
}));

function renderMovimientos() {
  const lista = datos.movimientos
    .filter((m) => enMes(m.fecha) && (filtroMov === 'todos' || m.tipo === filtroMov))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  $('#listaMov').innerHTML = lista.length
    ? lista.map((m) => `<li class="item" data-id="${m.id}">
        <div class="info">
          <div class="principal">${escapar(m.descripcion || m.categoria)}</div>
          <div class="sec">${escapar(m.categoria)} · ${fmtCorto(m.fecha)}</div>
        </div>
        <div class="monto ${m.tipo}">${m.tipo === 'gasto' ? '−' : '+'}${fmtDinero(m.monto)}</div>
        <button class="borrar" data-tipo="mov" aria-label="Eliminar">✕</button>
      </li>`).join('')
    : '<li class="vacio">Sin movimientos este mes</li>';
}

// ---------- Resumen ----------
function renderResumen() {
  const delMes = datos.movimientos.filter((m) => enMes(m.fecha));
  const suma = (tipo) => delMes.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.monto, 0);
  const ingresos = suma('ingreso');
  const gastos = suma('gasto');
  const balance = ingresos - gastos;
  $('#totIngresos').textContent = fmtDinero(ingresos, 0);
  $('#totGastos').textContent = fmtDinero(gastos, 0);
  $('#totBalance').textContent = (balance < 0 ? '−' : '') + fmtDinero(Math.abs(balance), 0);
  $('#totBalance').style.color = balance < 0 ? 'var(--gasto)' : 'var(--ingreso)';

  const porCat = {};
  delMes.filter((m) => m.tipo === 'gasto').forEach((m) => { porCat[m.categoria] = (porCat[m.categoria] || 0) + m.monto; });
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 1;
  $('#porCategoria').innerHTML = cats.length
    ? cats.map(([c, v]) => `<div class="barra">
        <div class="cab"><span>${escapar(c)}</span><span>${fmtDinero(v)} · ${Math.round((v / gastos) * 100)}%</span></div>
        <div class="pista"><div class="relleno" style="width:${(v / max) * 100}%"></div></div>
      </div>`).join('')
    : '<p class="vacio">Sin gastos este mes</p>';

  const hoy = hoyISO();
  const proximos = datos.agenda.filter((e) => !e.hecho && e.fecha >= hoy).sort(ordenAgenda).slice(0, 5);
  $('#proximos').innerHTML = proximos.length
    ? proximos.map((e) => itemAgenda(e, true)).join('')
    : '<li class="vacio">Nada agendado</li>';
}

// ---------- Acciones en listas (delegación) ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.borrar');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  if (!confirm('¿Eliminar este elemento?')) return;
  const col = btn.dataset.tipo === 'agenda' ? 'agenda' : 'movimientos';
  datos[col] = datos[col].filter((x) => x.id !== id);
  guardar();
  render();
});
document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('toggle')) return;
  const ev = datos.agenda.find((x) => x.id === e.target.closest('[data-id]').dataset.id);
  if (ev) { ev.hecho = e.target.checked; guardar(); render(); }
});

// ---------- Respaldo ----------
$('#btnExportar').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `asistente-respaldo-${hoyISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#inputImportar').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  try {
    const d = JSON.parse(await archivo.text());
    if (!Array.isArray(d.agenda) || !Array.isArray(d.movimientos)) throw new Error('formato');
    if (!confirm('Esto reemplaza los datos actuales. ¿Continuar?')) return;
    datos.agenda = d.agenda;
    datos.movimientos = d.movimientos;
    guardar();
    render();
    aviso('Datos importados');
  } catch (err) {
    aviso('Archivo no válido');
  } finally {
    e.target.value = '';
  }
});

// ---------- Render general ----------
function render() {
  const mes = new Date(mesActual.anio, mesActual.mes, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  $('#mesLabel').textContent = mes.charAt(0).toUpperCase() + mes.slice(1);
  renderResumen();
  renderAgenda();
  renderMovimientos();
}
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
