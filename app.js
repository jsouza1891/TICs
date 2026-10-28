'use strict';

const CLAVE = 'asistente-personal-v1';
const CATEGORIAS = {
  gasto: ['Personal', 'Comida', 'Servicios', 'Ocio', 'Proveedores', 'Ventas', 'Otros'],
  ingreso: ['Sueldo', 'Ventas', 'Servicios', 'Otros'],
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
const COLECCIONES = ['agenda', 'movimientos'];
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
const TITULOS = { agenda: 'Agenda', dinero: 'Dinero', cuenta: 'Cuenta' };

const claveMes = () => `${mesActual.anio}-${pad(mesActual.mes + 1)}`;
const enMes = (iso) => iso.startsWith(claveMes());

// ---------- Navegación ----------
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('activo', x === b));
  $$('.vista').forEach((v) => v.classList.toggle('activa', v.id === 'vista-' + b.dataset.vista));
  $('#titulo').textContent = TITULOS[b.dataset.vista];
  // el selector de mes solo aplica a la parte económica
  $('.mes').style.visibility = b.dataset.vista === 'dinero' ? 'visible' : 'hidden';
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
  agregar('agenda', {
    id: nuevoId(),
    titulo: f.titulo.value.trim(),
    fecha: f.fecha.value,
    hora: f.hora.value,
    nota: f.nota.value.trim(),
    area: f.area.value,
    hecho: false,
  });
  f.titulo.value = ''; f.hora.value = ''; f.nota.value = '';
  aviso('Evento agregado');
});
$('#verHechos').addEventListener('change', render);

let filtroArea = 'todas';
$$('#filtrosAgenda .chip').forEach((c) => c.addEventListener('click', () => {
  filtroArea = c.dataset.area;
  $$('#filtrosAgenda .chip').forEach((x) => x.classList.toggle('activo', x === c));
  renderAgenda();
}));
// los eventos cargados antes de existir las dos agendas cuentan como personales
const areaDe = (ev) => ev.area || 'personal';

const ordenAgenda = (a, b) => (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99'));

// Vencimiento: la hora indicada, o el final del día si no tiene hora
const UN_DIA = 24 * 60 * 60 * 1000;
function vencimiento(ev) {
  const [h, m] = (ev.hora || '23:59').split(':').map(Number);
  const d = parseFecha(ev.fecha);
  d.setHours(h, m, 59);
  return d;
}
function urgencia(ev) {
  if (ev.hecho) return '';
  const falta = vencimiento(ev) - Date.now();
  if (falta < 0) return 'vencido';
  return falta <= UN_DIA ? 'por-vencer' : '';
}

function itemAgenda(ev, conFecha) {
  const sec = [conFecha ? fmtCorto(ev.fecha) : '', ev.hora, ev.nota].filter(Boolean).map(escapar).join(' · ');
  const area = areaDe(ev);
  const acts = ev.actualizaciones || [];
  const ultima = acts.length
    ? `<div class="sec ultima">💬 ${acts.length} · ${escapar(acts[acts.length - 1].texto)}</div>` : '';
  return `<li class="item ${ev.hecho ? 'hecho' : ''} ${urgencia(ev)}" data-id="${ev.id}">
    <input type="checkbox" class="toggle" ${ev.hecho ? 'checked' : ''} aria-label="Marcar como hecho">
    <div class="info abrir-detalle"><div class="principal">${escapar(ev.titulo)} <span class="etiqueta ${area}">${area === 'laboral' ? 'Laboral' : 'Personal'}</span></div>${sec ? `<div class="sec">${sec}</div>` : ''}${ultima}</div>
    <button class="borrar" data-tipo="agenda" aria-label="Eliminar">✕</button>
  </li>`;
}

function renderAgenda() {
  const verHechos = $('#verHechos').checked;
  const eventos = datos.agenda
    .filter((e) => (verHechos || !e.hecho) && (filtroArea === 'todas' || areaDe(e) === filtroArea))
    .sort(ordenAgenda);
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
  agregar('movimientos', {
    id: nuevoId(),
    tipo: f.tipo.value,
    monto,
    categoria: f.categoria.value,
    fecha: f.fecha.value,
    descripcion: f.descripcion.value.trim(),
  });
  f.monto.value = ''; f.descripcion.value = '';
  aviso(f.tipo.value === 'gasto' ? 'Gasto guardado' : 'Ingreso guardado');
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
}

// ---------- Acciones en listas (delegación) ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.borrar');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  if (!confirm('¿Eliminar este elemento?')) return;
  eliminar(btn.dataset.tipo === 'agenda' ? 'agenda' : 'movimientos', id);
});
document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('toggle')) return;
  const ev = datos.agenda.find((x) => x.id === e.target.closest('[data-id]').dataset.id);
  if (ev) marcarHecho(ev, e.target.checked);
});

// hechoEn guarda cuándo se terminó el trabajo, para llevar el control de lo realizado
const marcarHecho = (ev, hecho) => actualizar('agenda', ev.id, { hecho, hechoEn: hecho ? new Date().toISOString() : null });

// ---------- Detalle de tarea y actualizaciones ----------
const fmtMomento = (iso) => new Date(iso).toLocaleString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
let detalleId = null;
const eventoDetalle = () => datos.agenda.find((x) => x.id === detalleId);

document.addEventListener('click', (e) => {
  const info = e.target.closest('.abrir-detalle');
  if (!info) return;
  detalleId = info.closest('[data-id]').dataset.id;
  renderDetalle();
  $('#detalle').showModal();
});
$('#detCerrar').addEventListener('click', () => $('#detalle').close());
$('#detalle').addEventListener('close', () => { detalleId = null; });
$('#detHecho').addEventListener('change', (e) => {
  const ev = eventoDetalle();
  if (ev) marcarHecho(ev, e.target.checked);
});

$('#formActualizacion').addEventListener('submit', (e) => {
  e.preventDefault();
  const ev = eventoDetalle();
  const texto = e.target.texto.value.trim();
  if (!ev || !texto) return;
  const nueva = { id: nuevoId(), texto, fecha: new Date().toISOString() };
  actualizar('agenda', ev.id, { actualizaciones: [...(ev.actualizaciones || []), nueva] });
  e.target.texto.value = '';
});
$('#detActualizaciones').addEventListener('click', (e) => {
  const btn = e.target.closest('.borrar-act');
  const ev = eventoDetalle();
  if (!btn || !ev || !confirm('¿Eliminar esta actualización?')) return;
  actualizar('agenda', ev.id, { actualizaciones: (ev.actualizaciones || []).filter((a) => a.id !== btn.dataset.id) });
});

// Se llama en cada render, así el detalle abierto refleja cambios hechos desde otro dispositivo
function renderDetalle() {
  if (!detalleId) return;
  const ev = eventoDetalle();
  if (!ev) { $('#detalle').close(); return; }
  const area = areaDe(ev);
  $('#detTitulo').innerHTML = `${escapar(ev.titulo)} <span class="etiqueta ${area}">${area === 'laboral' ? 'Laboral' : 'Personal'}</span>`;
  $('#detInfo').textContent = [fmtDia(ev.fecha), ev.hora, ev.nota].filter(Boolean).join(' · ');
  $('#detHecho').checked = !!ev.hecho;
  $('#detHechoEn').textContent = ev.hecho && ev.hechoEn ? `Realizado el ${fmtMomento(ev.hechoEn)}` : '';
  const acts = ev.actualizaciones || [];
  $('#detActualizaciones').innerHTML = acts.length
    ? acts.map((a) => `<li>
        <div class="act-cab"><span>${fmtMomento(a.fecha)}</span>
          <button class="borrar borrar-act" data-id="${a.id}" aria-label="Eliminar actualización">✕</button></div>
        <div class="act-texto">${escapar(a.texto)}</div>
      </li>`).join('')
    : '<li class="vacio">Todavía no hay actualizaciones</li>';
}

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
    // los respaldos viejos o editados a mano pueden traer elementos sin id
    COLECCIONES.forEach((col) => d[col].forEach((x) => { x.id = x.id || nuevoId(); }));
    reemplazarTodo(d);
    aviso('Datos importados');
  } catch (err) {
    aviso('Archivo no válido');
  } finally {
    e.target.value = '';
  }
});

// ---------- Guardado: local o sincronizado con Firebase ----------
// Sin sesión iniciada los datos viven en localStorage. Con sesión, cada evento y
// movimiento es un documento en usuarios/{uid}/{colección}/{id}; los cambios se
// escriben en Firestore y vuelven por onSnapshot (al instante, incluso sin conexión).
const CLAVE_DUENO = CLAVE + '-dueno'; // uid al que pertenece la copia local
let usuario = null;
let db = null;
let desuscribir = [];

const leerDueno = () => { try { return localStorage.getItem(CLAVE_DUENO); } catch (e) { return null; } };
function fijarDueno(uid) {
  try { uid ? localStorage.setItem(CLAVE_DUENO, uid) : localStorage.removeItem(CLAVE_DUENO); } catch (e) { /* sin almacenamiento */ }
}
const refCol = (col) => db.collection('usuarios').doc(usuario.uid).collection(col);
// Estado visible en la sección Sincronización, para poder diagnosticar problemas
let errorSyncCodigo = null;
let conServidor = {};
function errorSync(e) {
  errorSyncCodigo = (e && e.code) || 'desconocido';
  aviso('No se pudo sincronizar');
  renderCuenta();
}

function agregar(col, item) {
  if (usuario) return void refCol(col).doc(item.id).set(item).catch(errorSync);
  datos[col].push(item);
  guardar(); render();
}
function actualizar(col, id, cambios) {
  if (usuario) return void refCol(col).doc(id).update(cambios).catch(errorSync);
  Object.assign(datos[col].find((x) => x.id === id) || {}, cambios);
  guardar(); render();
}
function eliminar(col, id) {
  if (usuario) return void refCol(col).doc(id).delete().catch(errorSync);
  datos[col] = datos[col].filter((x) => x.id !== id);
  guardar(); render();
}

// Escribe varias operaciones en lotes (Firestore admite hasta 500 por lote).
// No se espera la confirmación del servidor: sin conexión quedan en cola.
function escribirEnLotes(ops) {
  const promesas = [];
  for (let i = 0; i < ops.length; i += 400) {
    const lote = db.batch();
    ops.slice(i, i + 400).forEach(([ref, item]) => (item ? lote.set(ref, item) : lote.delete(ref)));
    promesas.push(lote.commit());
  }
  Promise.all(promesas).catch(errorSync);
}
const opsSubir = (d) => COLECCIONES.flatMap((col) => d[col].map((item) => [refCol(col).doc(item.id), item]));

function reemplazarTodo(d) {
  if (usuario) {
    const borrar = COLECCIONES.flatMap((col) => datos[col]
      .filter((x) => !d[col].some((y) => y.id === x.id))
      .map((x) => [refCol(col).doc(x.id), null]));
    return escribirEnLotes([...borrar, ...opsSubir(d)]);
  }
  COLECCIONES.forEach((col) => { datos[col] = d[col]; });
  guardar(); render();
}

function alCambiarUsuario(u) {
  desuscribir.forEach((f) => f());
  desuscribir = [];
  usuario = u;
  errorSyncCodigo = null;
  conServidor = {};
  if (u) {
    // Lo cargado antes de iniciar sesión por primera vez en este dispositivo se sube a la cuenta.
    // Si la copia local ya es de esta cuenta no se sube, para no revivir lo borrado desde otro equipo.
    if (!leerDueno()) escribirEnLotes(opsSubir(datos));
    fijarDueno(u.uid);
    desuscribir = COLECCIONES.map((col) => refCol(col).onSnapshot({ includeMetadataChanges: true }, (snap) => {
      datos[col] = snap.docs.map((doc) => doc.data());
      // fromCache: todavía no hubo respuesta del servidor (sin conexión o base de datos inaccesible)
      conServidor[col] = !snap.metadata.fromCache;
      guardar(); render(); renderCuenta();
    }, errorSync));
  }
  renderCuenta();
  mostrarPantalla(u ? 'app' : 'login');
}

// ---------- Inicio de sesión ----------
// Los usuarios con contraseña los crea el administrador en la consola de Firebase (no hay registro desde la app).
const ERRORES_LOGIN = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/user-disabled': 'Este usuario está deshabilitado.',
  'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
  'auth/network-request-failed': 'Sin conexión. Revisá internet y probá de nuevo.',
  'auth/operation-not-allowed': 'Este método de inicio de sesión no está habilitado.',
  'auth/admin-restricted-operation': 'Este usuario no tiene acceso. Pedile al administrador que lo cree.',
};
const errorLogin = (e) => { $('#loginError').textContent = ERRORES_LOGIN[e.code] || `No se pudo iniciar sesión (${e.code || 'error'}).`; };

function mostrarPantalla(estado) {
  document.body.dataset.estado = estado;
  if (estado !== 'login') $('#loginError').textContent = '';
}

$('#formLogin').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!db) return;
  $('#loginError').textContent = '';
  const f = e.target;
  firebase.auth().signInWithEmailAndPassword(f.email.value.trim(), f.clave.value)
    .then(() => { f.clave.value = ''; })
    .catch(errorLogin);
});

$('#btnOlvide').addEventListener('click', () => {
  const email = $('#formLogin').email.value.trim();
  if (!email) { $('#loginError').textContent = 'Escribí tu correo arriba y tocá de nuevo "¿Olvidaste tu contraseña?".'; return; }
  enviarCambioClave(email);
});
// El mensaje es el mismo exista o no el usuario, para no revelar qué correos tienen cuenta
function enviarCambioClave(email) {
  firebase.auth().sendPasswordResetEmail(email)
    .catch(() => {})
    .then(() => aviso('Si el correo tiene cuenta, te llega un mail para elegir contraseña'));
}

function iniciarConGoogle() {
  if (!db) return;
  $('#loginError').textContent = '';
  const proveedor = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(proveedor).catch((e) => {
    // algunos navegadores (o la app instalada en iPhone) no permiten ventanas emergentes
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      return firebase.auth().signInWithRedirect(proveedor);
    }
    if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) errorLogin(e);
  });
}
$('#btnGoogle').addEventListener('click', iniciarConGoogle);

function cerrarSesion() {
  if (!confirm('¿Cerrar sesión? Tus datos quedan guardados en tu cuenta y se borran de este dispositivo.')) return;
  firebase.auth().signOut().then(() => {
    COLECCIONES.forEach((col) => { datos[col] = []; });
    fijarDueno(null);
    guardar(); render();
  });
}

function renderCuenta() {
  const el = $('#cuenta');
  if (usuario) {
    const estado = errorSyncCodigo
      ? `⚠️ Error de sincronización: <strong>${escapar(errorSyncCodigo)}</strong>`
      : COLECCIONES.every((col) => conServidor[col]) ? '✅ Conectado con el servidor' : '⏳ Conectando con el servidor…';
    const conClave = usuario.providerData.some((p) => p.providerId === 'password');
    el.innerHTML = `<p class="ayuda">Sesión iniciada con <strong>${escapar(usuario.email || usuario.displayName || 'tu cuenta')}</strong>.<br>${estado}</p>
      <div class="fila-botones">
        ${conClave ? '<button id="btnClave" class="secundario">Cambiar contraseña</button>' : ''}
        <button id="btnSalir" class="secundario">Cerrar sesión</button>
      </div>`;
    $('#btnSalir').addEventListener('click', cerrarSesion);
    if (conClave) $('#btnClave').addEventListener('click', () => enviarCambioClave(usuario.email));
  } else {
    el.innerHTML = '';
  }
}

if (window.firebase && window.FIREBASE_CONFIG) {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* sin cache offline, igual funciona */ });
  firebase.auth().getRedirectResult().catch(() => aviso('No se pudo iniciar sesión'));
  firebase.auth().onAuthStateChanged(alCambiarUsuario);
} else {
  // sin el SDK de Firebase (primera apertura sin conexión) no se puede iniciar sesión
  mostrarPantalla('login');
  $('#loginError').textContent = 'No se pudo conectar. Revisá internet y volvé a abrir la app.';
}
renderCuenta();

// ---------- Render general ----------
function render() {
  const mes = new Date(mesActual.anio, mesActual.mes, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  $('#mesLabel').textContent = mes.charAt(0).toUpperCase() + mes.slice(1);
  renderResumen();
  renderAgenda();
  renderMovimientos();
  renderDetalle();
}
render();
// los colores de vencimiento dependen de la hora: se recalculan cada minuto
setInterval(render, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
