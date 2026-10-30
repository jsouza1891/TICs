'use strict';

const CLAVE = 'asistente-personal-v1';
// Se muestra en Cuenta para saber qué versión está usando cada dispositivo: actualizarla al publicar
const VERSION = '30/10/2026 b';
const CATEGORIAS = {
  gasto: ['Personal', 'Comida', 'Servicios', 'Ocio', 'Proveedores', 'Ventas', 'Otros'],
  ingreso: ['Sueldo', 'Ventas', 'Servicios', 'Otros'],
};

// ---------- Datos ----------
// Cada colección es una lista de documentos. "agenda" son las órdenes de trabajo; el comercio
// (productos, proveedores, compras, ventas, pagos y la cotización en config) está en comercio.js.
const COLECCIONES = ['agenda', 'movimientos', 'clientes', 'productos', 'proveedores', 'compras', 'ventas', 'pagos', 'config'];
// Completa las colecciones que falten (datos o respaldos de versiones anteriores)
const completar = (d) => { COLECCIONES.forEach((col) => { if (!Array.isArray(d[col])) d[col] = []; }); return d; };
function cargar() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE));
    if (d && Array.isArray(d.agenda) && Array.isArray(d.movimientos)) return completar(d);
  } catch (e) { /* almacenamiento no disponible o dañado */ }
  return completar({});
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
// Dos monedas: pesos uruguayos y dólares. Lo cargado antes de existir la moneda cuenta como pesos.
const MONEDAS = { UYU: '$', USD: 'US$' };
const monedaDe = (x) => x.moneda || 'UYU';
// es-UY agrupa miles también en números de 4 cifras (1.500 y no 1500)
const fmtDinero = (n, moneda = 'UYU', dec = 2) => `${MONEDAS[moneda] || '$'} ${n.toLocaleString('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
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
const TITULOS = { ordenes: 'Órdenes', ventas: 'Ventas', clientes: 'Clientes', productos: 'Productos', proveedores: 'Proveedores', dinero: 'Dinero', cuenta: 'Cuenta' };

const claveMes = () => `${mesActual.anio}-${pad(mesActual.mes + 1)}`;
const enMes = (iso) => iso.startsWith(claveMes());

// ---------- Navegación (panel lateral; en el celular se abre con ☰) ----------
function irA(vista) {
  $$('.lateral [data-vista]').forEach((x) => x.classList.toggle('activo', x.dataset.vista === vista));
  $$('.vista').forEach((v) => v.classList.toggle('activa', v.id === 'vista-' + vista));
  $('#titulo').textContent = TITULOS[vista];
  // el selector de mes solo aplica a la parte económica
  $('.mes').style.visibility = vista === 'dinero' ? 'visible' : 'hidden';
  document.body.classList.remove('menu-abierto');
}
$$('.lateral [data-vista]').forEach((b) => b.addEventListener('click', () => irA(b.dataset.vista)));
$('#btnMenu').addEventListener('click', () => document.body.classList.toggle('menu-abierto'));
$('#velo').addEventListener('click', () => document.body.classList.remove('menu-abierto'));
// botón ✕ genérico de los diálogos
$$('dialog [data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

function cambiarMes(delta) {
  const d = new Date(mesActual.anio, mesActual.mes + delta, 1);
  mesActual = { anio: d.getFullYear(), mes: d.getMonth() };
  render();
}
$('#mesPrev').addEventListener('click', () => cambiarMes(-1));
$('#mesNext').addEventListener('click', () => cambiarMes(1));

// ---------- Órdenes de trabajo ----------
// Se guardan en la colección "agenda" (antes era una agenda de tareas): titulo, fecha/hora de entrega,
// nota (detalles), clienteId, precio/moneda, hecho/hechoEn y actualizaciones (novedades).
// El precio solo se muestra en el detalle, nunca en las listas: la lista se puede mostrar a otros.
const clientePorId = (id) => (id ? datos.clientes.find((c) => c.id === id) : null);
const ordenPorId = (id) => datos.agenda.find((x) => x.id === id);
const normalizar = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

$('#verHechos').addEventListener('change', render);
$('#buscarOrden').addEventListener('input', renderAgenda);

// Las órdenes son generales: el campo viejo `area` (Personal/Laboral) quedó en los datos pero ya no se usa

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

// Número correlativo de orden, para control y para el comprobante: 12 → "0012"
const fmtNumero = (n) => String(n).padStart(4, '0');
const siguienteNumeroOrden = () => datos.agenda.reduce((m, o) => Math.max(m, Number(o.numero) || 0), 0) + 1;

function itemAgenda(ev, conFecha) {
  const cliente = clientePorId(ev.clienteId);
  const sec = [cliente && `👤 ${cliente.nombre}`, conFecha ? fmtCorto(ev.fecha) : '', ev.hora, porOtro(ev.autor) && `por ${ev.autor}`]
    .filter(Boolean).map(escapar).join(' · ');
  const acts = ev.actualizaciones || [];
  const ultima = acts.length
    ? `<div class="sec ultima">💬 ${acts.length} · ${escapar(acts[acts.length - 1].texto)}</div>` : '';
  return `<li class="item ${ev.hecho ? 'hecho' : ''} ${urgencia(ev)}" data-id="${ev.id}">
    <input type="checkbox" class="toggle" ${ev.hecho ? 'checked' : ''} aria-label="Marcar como realizada">
    <div class="info abrir-detalle"><div class="principal">${ev.numero ? `<span class="num-orden">${fmtNumero(ev.numero)}</span> ` : ''}${escapar(ev.titulo)}</div>${sec ? `<div class="sec">${sec}</div>` : ''}${ultima}</div>
  </li>`;
}

function renderAgenda() {
  const verHechos = $('#verHechos').checked;
  const busqueda = normalizar($('#buscarOrden').value.trim());
  const coincide = (e) => !busqueda
    || normalizar([e.numero && fmtNumero(e.numero), e.titulo, e.nota, (clientePorId(e.clienteId) || {}).nombre].join(' ')).includes(busqueda);
  const eventos = datos.agenda
    .filter((e) => (verHechos || !e.hecho) && coincide(e))
    .sort(ordenAgenda);
  if (!eventos.length) {
    $('#listaAgenda').innerHTML = `<p class="vacio">${busqueda ? 'No hay órdenes que coincidan' : 'No hay órdenes pendientes 🎉'}</p>`;
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

// Formulario de orden (nueva o edición)
let ordenEditando = null;
function opcionesClientes(seleccionado) {
  const clientes = [...datos.clientes].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return '<option value="">Sin cliente</option>' + clientes
    .map((c) => `<option value="${c.id}" ${c.id === seleccionado ? 'selected' : ''}>${escapar(c.nombre)}</option>`).join('');
}
function abrirFormOrden(orden, clienteId) {
  ordenEditando = orden ? orden.id : null;
  const f = $('#formOrden');
  f.reset();
  $('#dlgOrdenTitulo').textContent = orden ? 'Editar orden' : 'Nueva orden';
  f.clienteId.innerHTML = opcionesClientes(orden ? orden.clienteId : clienteId);
  f.titulo.value = orden ? orden.titulo : '';
  f.fecha.value = orden ? orden.fecha : hoyISO();
  f.hora.value = orden ? orden.hora || '' : '';
  f.nota.value = orden ? orden.nota || '' : '';
  f.precio.value = orden && orden.precio != null ? orden.precio : '';
  f.moneda.value = (orden && orden.moneda) || 'UYU';
  // con el stock ya descontado (orden realizada) los productos no se pueden cambiar
  editorOrden.cargar(orden ? orden.lineas : [], f.moneda.value, !!(orden && orden.stockDescontado));
  actualizarTotalOrden();
  $('#dlgOrden').showModal();
}
function actualizarTotalOrden() {
  const f = $('#formOrden');
  const servicio = parseFloat(f.precio.value) || 0;
  const productos = totalLineas(editorOrden.lineas);
  $('#totalOrden').textContent = productos ? `Total: ${fmtDinero(servicio + productos, f.moneda.value)} (servicio + productos)` : '';
}
$('#formOrden').precio.addEventListener('input', actualizarTotalOrden);
$('#formOrden').moneda.addEventListener('change', (e) => { editorOrden.cambiarMoneda(e.target.value); actualizarTotalOrden(); });
$('#btnNuevaOrden').addEventListener('click', () => abrirFormOrden(null));
$('#formOrden').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const precio = f.precio.value === '' ? null : Math.round(parseFloat(f.precio.value) * 100) / 100;
  const campos = {
    titulo: f.titulo.value.trim(),
    clienteId: f.clienteId.value || null,
    fecha: f.fecha.value,
    hora: f.hora.value,
    nota: f.nota.value.trim(),
    precio: Number.isFinite(precio) ? precio : null,
    moneda: f.moneda.value,
  };
  if (!editorOrden.bloqueado) {
    const lineas = editorOrden.validas();
    if (!lineas) return;
    campos.lineas = lineas;
  }
  if (ordenEditando) {
    actualizar('agenda', ordenEditando, campos);
    aviso('Orden actualizada');
  } else {
    agregar('agenda', { id: nuevoId(), numero: siguienteNumeroOrden(), ...campos, hecho: false, creada: new Date().toISOString() });
    aviso('Orden creada');
  }
  $('#dlgOrden').close();
});

// ---------- Clientes ----------
$('#buscarCliente').addEventListener('input', renderClientes);
const pendientesDe = (clienteId) => datos.agenda.filter((o) => o.clienteId === clienteId && !o.hecho).length;

function renderClientes() {
  const busqueda = normalizar($('#buscarCliente').value.trim());
  const lista = datos.clientes
    .filter((c) => !busqueda || normalizar([c.nombre, c.telefono, c.email, c.rut, c.direccion].join(' ')).includes(busqueda))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  $('#listaClientes').innerHTML = lista.length
    ? lista.map((c) => {
      const pend = pendientesDe(c.id);
      const sec = [c.telefono, pend && `${pend} ${pend === 1 ? 'orden pendiente' : 'órdenes pendientes'}`].filter(Boolean).map(escapar).join(' · ');
      return `<li class="item" data-id="${c.id}">
        <div class="info abrir-cliente"><div class="principal">${escapar(c.nombre)}</div>${sec ? `<div class="sec">${sec}</div>` : ''}</div>
      </li>`;
    }).join('')
    : `<li class="vacio">${busqueda ? 'No hay clientes que coincidan' : 'Todavía no hay clientes. Tocá "+ Nuevo cliente".'}</li>`;
}

let clienteEditando = null;
function abrirFormCliente(cliente) {
  clienteEditando = cliente ? cliente.id : null;
  const f = $('#formCliente');
  f.reset();
  $('#dlgClienteTitulo').textContent = cliente ? 'Editar cliente' : 'Nuevo cliente';
  ['nombre', 'telefono', 'email', 'direccion', 'rut', 'notas'].forEach((k) => { f[k].value = cliente ? cliente[k] || '' : ''; });
  $('#dlgCliente').showModal();
}
$('#btnNuevoCliente').addEventListener('click', () => abrirFormCliente(null));
$('#formCliente').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const campos = {};
  ['nombre', 'telefono', 'email', 'direccion', 'rut', 'notas'].forEach((k) => { campos[k] = f[k].value.trim(); });
  if (clienteEditando) {
    actualizar('clientes', clienteEditando, campos);
    aviso('Cliente actualizado');
  } else {
    agregar('clientes', { id: nuevoId(), ...campos, creado: new Date().toISOString() });
    aviso('Cliente guardado');
  }
  $('#dlgCliente').close();
});

// WhatsApp necesita el número internacional: 099 123 456 → 59899123456 (Uruguay por defecto)
function numeroWhatsApp(tel) {
  let d = (tel || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '598' + d.slice(1);
  else if (d.length === 8) d = '598' + d;
  return d;
}

let clienteVerId = null;
function abrirCliente(id) {
  clienteVerId = id;
  renderCliente();
  $('#dlgVerCliente').showModal();
}
$('#dlgVerCliente').addEventListener('close', () => { clienteVerId = null; });
$('#cliEditar').addEventListener('click', () => abrirFormCliente(clientePorId(clienteVerId)));
$('#cliNuevaOrden').addEventListener('click', () => abrirFormOrden(null, clienteVerId));
$('#cliCobro').addEventListener('click', () => abrirPago({ tipo: 'cobro', clienteId: clienteVerId, titulo: `Cobro: ${clientePorId(clienteVerId).nombre}` }));
$('#cliVenta').addEventListener('click', () => abrirVenta(clienteVerId));
$('#cliEliminar').addEventListener('click', () => {
  const c = clientePorId(clienteVerId);
  if (!c || !confirm(`¿Eliminar a ${c.nombre}? Sus órdenes no se borran, quedan sin cliente.`)) return;
  eliminar('clientes', c.id);
  $('#dlgVerCliente').close();
});

// Lista de datos (dt/dd) sin campos vacíos
const filasDatos = (pares) => pares.filter(([, v]) => v)
  .map(([k, v]) => `<dt>${k}</dt><dd>${escapar(v)}</dd>`).join('');

function renderCliente() {
  if (!clienteVerId) return;
  const c = clientePorId(clienteVerId);
  if (!c) { $('#dlgVerCliente').close(); return; }
  $('#cliNombre').textContent = c.nombre;
  $('#cliDatos').innerHTML = filasDatos([['Teléfono', c.telefono], ['Correo', c.email], ['Dirección', c.direccion], ['RUT', c.rut], ['Notas', c.notas]]);
  const wa = numeroWhatsApp(c.telefono);
  $('#cliContacto').innerHTML = [
    c.telefono && `<a class="boton secundario" href="tel:${escapar(c.telefono.replace(/[^\d+]/g, ''))}">📞 Llamar</a>`,
    wa && `<a class="boton secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>`,
    c.email && `<a class="boton secundario" href="mailto:${escapar(c.email)}">✉️ Correo</a>`,
  ].filter(Boolean).join('');
  $('#cliCuenta').innerHTML = htmlCuenta(cuentaCliente(c.id), 'cliente');
  const ordenes = datos.agenda.filter((o) => o.clienteId === c.id)
    .sort((a, b) => (a.hecho - b.hecho) || ordenAgenda(a, b));
  $('#cliOrdenes').innerHTML = ordenes.length
    ? ordenes.map((o) => itemAgenda(o, true)).join('')
    : '<li class="vacio">Sin órdenes todavía</li>';
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
    moneda: f.moneda.value,
    categoria: f.categoria.value,
    fecha: f.fecha.value,
    descripcion: f.descripcion.value.trim(),
  });
  f.monto.value = ''; f.descripcion.value = '';
  aviso(f.tipo.value === 'gasto' ? 'Gasto guardado' : 'Ingreso guardado');
});

$$('#filtrosMov .chip').forEach((c) => c.addEventListener('click', () => {
  filtroMov = c.dataset.filtro;
  $$('#filtrosMov .chip').forEach((x) => x.classList.toggle('activo', x === c));
  renderMovimientos();
}));
let filtroMoneda = 'todas';
$$('#filtrosMoneda .chip').forEach((c) => c.addEventListener('click', () => {
  filtroMoneda = c.dataset.moneda;
  $$('#filtrosMoneda .chip').forEach((x) => x.classList.toggle('activo', x === c));
  renderMovimientos();
}));

function renderMovimientos() {
  const lista = datos.movimientos
    .filter((m) => enMes(m.fecha) && (filtroMov === 'todos' || m.tipo === filtroMov)
      && (filtroMoneda === 'todas' || monedaDe(m) === filtroMoneda))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  $('#listaMov').innerHTML = lista.length
    ? lista.map((m) => `<li class="item" data-id="${m.id}">
        <div class="info">
          <div class="principal">${escapar(m.descripcion || m.categoria)}</div>
          <div class="sec">${escapar(m.categoria)} · ${fmtCorto(m.fecha)}${porOtro(m.autor) ? ` · ${escapar(m.autor)}` : ''}</div>
        </div>
        <div class="monto ${m.tipo}">${m.tipo === 'gasto' ? '−' : '+'}${fmtDinero(m.monto, monedaDe(m))}</div>
        <button class="borrar" data-tipo="mov" aria-label="Eliminar">✕</button>
      </li>`).join('')
    : '<li class="vacio">Sin movimientos este mes</li>';
}

// ---------- Resumen: una caja por moneda ----------
// Saldo de la caja = todo lo acumulado hasta el fin del mes elegido; ingresos y gastos son los del mes.
const NOMBRE_CAJA = { UYU: 'Caja pesos', USD: 'Caja dólares' };
const conSigno = (n, moneda, dec) => (n < 0 ? '−' : '') + fmtDinero(Math.abs(n), moneda, dec);

function renderResumen() {
  const finMes = claveMes() + '-31';
  const suma = (lista, tipo) => lista.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.monto, 0);
  $('#cajas').innerHTML = Object.keys(MONEDAS).map((mon) => {
    const deMoneda = datos.movimientos.filter((m) => monedaDe(m) === mon);
    const hastaMes = deMoneda.filter((m) => m.fecha <= finMes);
    const delMes = deMoneda.filter((m) => enMes(m.fecha));
    const saldo = suma(hastaMes, 'ingreso') - suma(hastaMes, 'gasto');
    return `<div class="caja">
      <div class="caja-cab"><span>${NOMBRE_CAJA[mon]}</span><strong class="${saldo < 0 ? 'negativo' : ''}">${conSigno(saldo, mon, 0)}</strong></div>
      <div class="caja-mes">
        <span>Ingresos del mes <b class="ingreso">+${fmtDinero(suma(delMes, 'ingreso'), mon, 0)}</b></span>
        <span>Gastos del mes <b class="gasto">−${fmtDinero(suma(delMes, 'gasto'), mon, 0)}</b></span>
      </div>
    </div>`;
  }).join('');

  const bloques = Object.keys(MONEDAS).map((mon) => {
    const gastosMes = datos.movimientos.filter((m) => m.tipo === 'gasto' && monedaDe(m) === mon && enMes(m.fecha));
    if (!gastosMes.length) return '';
    const total = gastosMes.reduce((s, m) => s + m.monto, 0);
    const porCat = {};
    gastosMes.forEach((m) => { porCat[m.categoria] = (porCat[m.categoria] || 0) + m.monto; });
    const cats = Object.entries(porCat).sort((x, y) => y[1] - x[1]);
    return `<div class="subtitulo">${mon === 'UYU' ? 'Pesos' : 'Dólares'}</div>` + cats.map(([c, v]) => `<div class="barra">
        <div class="cab"><span>${escapar(c)}</span><span>${fmtDinero(v, mon)} · ${Math.round((v / total) * 100)}%</span></div>
        <div class="pista"><div class="relleno" style="width:${(v / cats[0][1]) * 100}%"></div></div>
      </div>`).join('');
  }).join('');
  $('#porCategoria').innerHTML = bloques || '<p class="vacio">Sin gastos este mes</p>';
}

// ---------- Acciones en listas (delegación) ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.borrar');
  if (!btn) return;
  if (btn.dataset.tipo !== 'mov') return; // los demás ✕ tienen su propio manejo
  eliminarMovimiento(btn.closest('[data-id]').dataset.id);
});
document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('toggle')) return;
  const ev = datos.agenda.find((x) => x.id === e.target.closest('[data-id]').dataset.id);
  if (ev) marcarHecho(ev, e.target.checked);
});

// hechoEn guarda cuándo se terminó el trabajo, para llevar el control de lo realizado
// (al marcarla realizada también descuenta del stock los productos usados: ver cambiarRealizada)
const marcarHecho = (ev, hecho) => cambiarRealizada(ev, hecho);

// ---------- Detalle de tarea y actualizaciones ----------
const fmtMomento = (iso) => new Date(iso).toLocaleString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
let detalleId = null;
const eventoDetalle = () => datos.agenda.find((x) => x.id === detalleId);

document.addEventListener('click', (e) => {
  const info = e.target.closest('.abrir-detalle');
  if (info) {
    detalleId = info.closest('[data-id]').dataset.id;
    renderDetalle();
    $('#detalle').showModal();
    return;
  }
  const cli = e.target.closest('.abrir-cliente');
  if (cli) abrirCliente(cli.closest('[data-id]').dataset.id);
});
$('#detEditar').addEventListener('click', () => abrirFormOrden(eventoDetalle()));
$('#detCobro').addEventListener('click', () => {
  const ev = eventoDetalle();
  const saldo = ev ? totalOrden(ev) - cobradoDe('ordenId', ev.id) : 0;
  abrirPago({ tipo: 'cobro', clienteId: ev.clienteId, ordenId: ev.id, moneda: monedaDe(ev), monto: saldo > 0 ? saldo : '', titulo: `Cobro: ${ev.titulo}` });
});
$('#detEliminar').addEventListener('click', () => {
  const ev = eventoDetalle();
  if (!ev || !confirm(`¿Eliminar la orden "${ev.titulo}"? No se puede deshacer.`)) return;
  eliminarOrden(ev);
  $('#detalle').close();
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
  const nueva = { id: nuevoId(), texto, fecha: new Date().toISOString(), autor: miNombre() };
  actualizar('agenda', ev.id, { actualizaciones: [...(ev.actualizaciones || []), nueva] });
  e.target.texto.value = '';
});
$('#detActualizaciones').addEventListener('click', (e) => {
  const btn = e.target.closest('.borrar-act');
  const ev = eventoDetalle();
  if (!btn || !ev || !confirm('¿Eliminar esta novedad?')) return;
  actualizar('agenda', ev.id, { actualizaciones: (ev.actualizaciones || []).filter((a) => a.id !== btn.dataset.id) });
});

// Se llama en cada render, así el detalle abierto refleja cambios hechos desde otro dispositivo
function renderDetalle() {
  if (!detalleId) return;
  const ev = eventoDetalle();
  if (!ev) { $('#detalle').close(); return; }
  $('#detTitulo').textContent = `${ev.numero ? `N.º ${fmtNumero(ev.numero)} · ` : ''}${ev.titulo}`;
  const cliente = clientePorId(ev.clienteId);
  $('#detDatos').innerHTML = filasDatos([
    ['Cliente', cliente && cliente.nombre],
    ['Entrega', [fmtDia(ev.fecha), ev.hora].filter(Boolean).join(' · ')],
    ['Detalles', ev.nota],
    ['Servicio', ev.precio != null ? fmtDinero(ev.precio, monedaDe(ev)) : ''],
    ['Creada', [ev.creada && fmtMomento(ev.creada), porOtro(ev.autor) && `por ${ev.autor}`].filter(Boolean).join(' ')],
  ]);
  // productos usados, total y lo cobrado (solo en el detalle: la lista de órdenes no muestra plata)
  const total = totalOrden(ev);
  const cobrado = cobradoDe('ordenId', ev.id);
  $('#detProductos').innerHTML = tablaLineas(ev.lineas, monedaDe(ev))
    + (total ? `<div class="total-documento">Total: ${fmtDinero(total, monedaDe(ev))}${ev.clienteId
      ? ` · Cobrado: ${fmtDinero(cobrado, monedaDe(ev))}${cobrado < total ? ` · <span class="negativo">Falta: ${fmtDinero(total - cobrado, monedaDe(ev))}</span>` : ' ✅'}` : ''}</div>` : '')
    + (ev.stockDescontado ? '<p class="ayuda">📦 Productos descontados del stock.</p>' : '');
  $('#detCobro').hidden = !ev.clienteId || !total;
  $('#detHecho').checked = !!ev.hecho;
  $('#detHechoEn').textContent = ev.hecho && ev.hechoEn
    ? `Realizado el ${fmtMomento(ev.hechoEn)}${porOtro(ev.hechoPor) ? ` por ${ev.hechoPor}` : ''}` : '';
  const acts = ev.actualizaciones || [];
  $('#detActualizaciones').innerHTML = acts.length
    ? acts.map((a) => `<li>
        <div class="act-cab"><span>${fmtMomento(a.fecha)}${porOtro(a.autor) ? ` · ${escapar(a.autor)}` : ''}</span>
          <button class="borrar borrar-act" data-id="${a.id}" aria-label="Eliminar actualización">✕</button></div>
        <div class="act-texto">${escapar(a.texto)}</div>
      </li>`).join('')
    : '<li class="vacio">Todavía no hay novedades</li>';
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
    completar(d); // respaldos de versiones anteriores
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
// Espacio de datos: por defecto el propio uid. Si existe miembros/{correo} con {espacio}, el usuario
// trabaja en ese espacio compartido (por ejemplo una empresa con varios socios). Lo arma el admin en la consola.
let espacio = null;
let nombreEspacio = '';
const refCol = (col) => db.collection('usuarios').doc(espacio).collection(col);
const CLAVE_ESPACIO = CLAVE + '-espacio';

async function resolverEspacio(u) {
  const email = (u.email || '').toLowerCase();
  try {
    const doc = email ? await db.collection('miembros').doc(email).get() : null;
    const r = doc && doc.exists ? { id: doc.data().espacio, nombre: doc.data().nombre || '' } : { id: u.uid, nombre: '' };
    try { localStorage.setItem(CLAVE_ESPACIO, JSON.stringify({ uid: u.uid, ...r })); } catch (e) { /* sin almacenamiento */ }
    return r;
  } catch (e) {
    // sin conexión: se usa el último espacio conocido de este usuario
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE_ESPACIO));
      if (g && g.uid === u.uid) return { id: g.id, nombre: g.nombre };
    } catch (e2) { /* nada guardado */ }
    return { id: u.uid, nombre: '' };
  }
}

// Autoría: con espacios compartidos se muestra quién cargó cada cosa (solo si no fue uno mismo)
const miNombre = () => (usuario ? usuario.displayName || (usuario.email || '').split('@')[0] : '');
// Usuarios sin correo: Firebase exige un correo, así que "juan" se guarda como juan@usuarios.tics.com.uy.
// Ese dominio no recibe mails: no sirve "olvidé mi contraseña" (la cambia el admin o el usuario desde Cuenta).
const DOMINIO_USUARIOS = 'usuarios.tics.com.uy';
const aCorreo = (usuarioOCorreo) => {
  const v = usuarioOCorreo.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${DOMINIO_USUARIOS}`;
};
const esUsuarioSinCorreo = (email) => (email || '').toLowerCase().endsWith('@' + DOMINIO_USUARIOS);
const nombreVisible = (u) => (esUsuarioSinCorreo(u.email) ? u.email.split('@')[0] : u.email || u.displayName || 'tu cuenta');
const porOtro = (autor) => (autor && autor !== miNombre() ? autor : '');
// Estado visible en la sección Sincronización, para poder diagnosticar problemas
let errorSyncCodigo = null;
let conServidor = {};
let pendientes = {}; // por colección: cambios hechos en este dispositivo que el servidor todavía no confirmó
function errorSync(e) {
  errorSyncCodigo = (e && e.code) || 'desconocido';
  aviso('No se pudo sincronizar');
  renderCuenta();
}

function agregar(col, item) {
  if (usuario) item.autor = miNombre();
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

let cambioUsuario = 0;
async function alCambiarUsuario(u) {
  const turno = ++cambioUsuario;
  desuscribir.forEach((f) => f());
  desuscribir = [];
  usuario = u;
  errorSyncCodigo = null;
  conServidor = {};
  pendientes = {};
  if (u) {
    const r = await resolverEspacio(u);
    if (turno !== cambioUsuario) return; // cambió el usuario mientras se buscaba el espacio
    espacio = r.id;
    nombreEspacio = r.nombre;
    // Lo cargado antes de iniciar sesión por primera vez en este dispositivo se sube a la cuenta.
    // Si la copia local ya es de esta cuenta no se sube, para no revivir lo borrado desde otro equipo.
    if (!leerDueno()) escribirEnLotes(opsSubir(datos));
    fijarDueno(u.uid);
    desuscribir = COLECCIONES.map((col) => refCol(col).onSnapshot({ includeMetadataChanges: true }, (snap) => {
      datos[col] = snap.docs.map((doc) => doc.data());
      // fromCache: todavía no hubo respuesta del servidor (sin conexión o base de datos inaccesible)
      conServidor[col] = !snap.metadata.fromCache;
      pendientes[col] = snap.docs.filter((d) => d.metadata && d.metadata.hasPendingWrites).length;
      // con la lista completa del servidor, numera las órdenes viejas que no tienen número
      if (col === 'agenda' && conServidor.agenda) numerarOrdenesViejas();
      guardar(); render(); renderCuenta();
    }, errorSync));
  }
  renderCuenta();
  mostrarPantalla(u ? 'app' : 'login');
}

// ---------- Inicio de sesión ----------
// Los usuarios con contraseña los crea el administrador en la consola de Firebase (no hay registro desde la app).
const ERRORES_LOGIN = {
  'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
  'auth/wrong-password': 'Usuario o contraseña incorrectos.',
  'auth/user-not-found': 'Usuario o contraseña incorrectos.',
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
  firebase.auth().signInWithEmailAndPassword(aCorreo(f.email.value), f.clave.value)
    .then(() => { f.clave.value = ''; })
    .catch(errorLogin);
});

$('#btnOlvide').addEventListener('click', () => {
  const valor = $('#formLogin').email.value.trim();
  if (!valor) { $('#loginError').textContent = 'Escribí tu usuario o correo arriba y tocá de nuevo "¿Olvidaste tu contraseña?".'; return; }
  if (esUsuarioSinCorreo(aCorreo(valor))) {
    $('#loginError').textContent = 'Tu usuario no tiene correo: pedile al administrador que te dé una contraseña nueva.';
    return;
  }
  enviarCambioClave(aCorreo(valor));
});
// El mensaje es el mismo exista o no el usuario, para no revelar qué correos tienen cuenta
function enviarCambioClave(email) {
  firebase.auth().sendPasswordResetEmail(email)
    .catch(() => {})
    .then(() => aviso('Si el correo tiene cuenta, te llega un mail para elegir contraseña'));
}

// Cambio de contraseña desde la app: Firebase pide volver a confirmar la contraseña actual
$('#dlgClaveCerrar').addEventListener('click', () => $('#dlgClave').close());
$('#formClave').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const error = (t) => { $('#claveError').textContent = t; };
  if (f.nueva.value !== f.repetir.value) return error('Las contraseñas nuevas no coinciden.');
  error('');
  const credencial = firebase.auth.EmailAuthProvider.credential(usuario.email, f.actual.value);
  usuario.reauthenticateWithCredential(credencial)
    .then(() => usuario.updatePassword(f.nueva.value))
    .then(() => { f.reset(); $('#dlgClave').close(); aviso('Contraseña cambiada'); })
    .catch((err) => error({
      'auth/invalid-credential': 'La contraseña actual no es correcta.',
      'auth/wrong-password': 'La contraseña actual no es correcta.',
      'auth/weak-password': 'La contraseña nueva es muy corta (mínimo 6 caracteres).',
      'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos.',
      'auth/network-request-failed': 'Sin conexión. Probá de nuevo con internet.',
    }[err.code] || `No se pudo cambiar (${err.code}).`));
});

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
    const compartido = espacio && espacio !== usuario.uid
      ? `<br>👥 Espacio compartido${nombreEspacio ? `: <strong>${escapar(nombreEspacio)}</strong>` : ''}` : '';
    // Para comparar dispositivos: cambios sin subir y un código corto del espacio de datos (tiene que coincidir)
    const sinSubir = Object.values(pendientes).reduce((a, n) => a + n, 0);
    const avisoPendientes = sinSubir ? `<br>⏳ <strong>${sinSubir}</strong> ${sinSubir === 1 ? 'cambio' : 'cambios'} de este dispositivo todavía sin subir al servidor` : '';
    const codigo = espacio ? `<br>Código de datos: <strong>${escapar(espacio.slice(-6))}</strong>` : '';
    el.innerHTML = `<p class="ayuda">Sesión iniciada con <strong>${escapar(nombreVisible(usuario))}</strong>.${compartido}<br>${estado}${avisoPendientes}${codigo}</p>
      <div class="fila-botones">
        ${conClave ? '<button id="btnClave" class="secundario">Cambiar contraseña</button>' : ''}
        <button id="btnSalir" class="secundario">Cerrar sesión</button>
      </div>`;
    $('#btnSalir').addEventListener('click', cerrarSesion);
    if (conClave) $('#btnClave').addEventListener('click', () => { $('#claveError').textContent = ''; $('#dlgClave').showModal(); });
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
  const mes = new Date(mesActual.anio, mesActual.mes, 1).toLocaleDateString('es', { month: innerWidth < 600 ? 'short' : 'long', year: 'numeric' }).replace(' de ', ' ').replace('.', '');
  $('#mesLabel').textContent = mes.charAt(0).toUpperCase() + mes.slice(1);
  renderResumen();
  renderAgenda();
  renderClientes();
  renderMovimientos();
  renderDetalle();
  renderCliente();
  renderComercio();
}
$('#version').textContent = VERSION;
// El primer render y el arranque están al final de comercio.js, que se carga después de este archivo.
