'use strict';
// Comercio: cotización del dólar, productos con stock, proveedores y compras, ventas,
// productos usados en órdenes, cobros/pagos y estados de cuenta. Usa lo definido en app.js.
//
// Colecciones (todas en usuarios/{espacio}):
//   productos   {nombre, codigo, moneda, costo, precio, stock, stockMin}
//   proveedores {nombre, telefono, email, direccion, rut, notas}
//   compras     {proveedorId, fecha, moneda, lineas, total, notas}          → suman stock
//   ventas      {clienteId|null, fecha, moneda, lineas, total, notas}      → restan stock
//   pagos       {tipo: 'cobro'|'pago', clienteId|proveedorId, ventaId|ordenId|compraId,
//                fecha, moneda, monto, nota, movimientoId}                 → cada uno genera un movimiento en Dinero
//   config      {id: 'general', cotizacion, cotizacionFecha}
// Líneas: [{productoId|null, nombre, cantidad, precio}] (productoId null = servicio libre en una venta).
// Lo que se debe: ventas y órdenes realizadas con cliente (total = servicio + productos), compras.
// Lo pagado: los pagos. Los saldos se llevan por moneda.

// ---------- Escritura de varios documentos juntos ----------
// ops: {tipo: 'set'|'update'|'delete', col, id, data} o {tipo: 'stock', id, delta}.
// Con sesión va en un solo lote de Firestore (todo o nada); el stock usa increment()
// para que dos personas vendiendo a la vez no se pisen.
function transaccion(ops) {
  // un producto borrado no puede actualizarse: se ignora su movimiento de stock
  ops = ops.filter((o) => o.tipo !== 'stock' || (o.delta && productoPorId(o.id)));
  if (usuario) {
    const lote = db.batch();
    ops.forEach((o) => {
      const ref = refCol(o.tipo === 'stock' ? 'productos' : o.col).doc(o.id);
      if (o.tipo === 'set') lote.set(ref, { ...o.data, autor: miNombre() });
      else if (o.tipo === 'update') lote.update(ref, o.data);
      else if (o.tipo === 'delete') lote.delete(ref);
      else lote.update(ref, { stock: firebase.firestore.FieldValue.increment(o.delta) });
    });
    lote.commit().catch(errorSync);
    return;
  }
  ops.forEach((o) => {
    if (o.tipo === 'set') datos[o.col].push({ ...o.data });
    else if (o.tipo === 'update') Object.assign(datos[o.col].find((x) => x.id === o.id) || {}, o.data);
    else if (o.tipo === 'delete') datos[o.col] = datos[o.col].filter((x) => x.id !== o.id);
    else { const p = productoPorId(o.id); p.stock = (Number(p.stock) || 0) + o.delta; }
  });
  guardar(); render();
}

// ---------- Utilidades ----------
const productoPorId = (id) => (id ? datos.productos.find((p) => p.id === id) : null);
const proveedorPorId = (id) => (id ? datos.proveedores.find((p) => p.id === id) : null);
const redondear = (n) => Math.round(n * 100) / 100;
const numero = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmtCantidad = (n) => Number(n).toLocaleString('es-UY', { maximumFractionDigits: 2 });
const totalLineas = (lineas) => redondear((lineas || []).reduce((s, l) => s + numero(l.cantidad) * numero(l.precio), 0));
const totalOrden = (o) => redondear(numero(o.precio) + totalLineas(o.lineas));
const lineasDeProductos = (lineas) => (lineas || []).filter((l) => l.productoId);
// fecha local (YYYY-MM-DD) de un momento ISO
const fechaLocal = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// lo cobrado o pagado a un documento: cobradoDe('ventaId', id)
const cobradoDe = (campo, id) => redondear(datos.pagos.filter((p) => p[campo] === id).reduce((s, p) => s + numero(p.monto), 0));

// ---------- Cotización del dólar ----------
const configGeneral = () => datos.config.find((c) => c.id === 'general') || {};
const cotizacion = () => numero(configGeneral().cotizacion);
// Convierte entre pesos y dólares con la cotización cargada; null si hace falta y no hay
function convertir(monto, de, a) {
  if (de === a) return monto;
  const c = cotizacion();
  if (!c) return null;
  return redondear(de === 'USD' ? monto * c : monto / c);
}
function pedirCotizacion() {
  const actual = cotizacion();
  const v = prompt('Cotización del dólar: ¿cuántos pesos vale 1 US$?', actual ? String(actual).replace('.', ',') : '');
  if (v === null) return;
  const n = parseFloat(v.replace(',', '.'));
  if (!(n > 0)) { aviso('Cotización no válida'); return; }
  const cambios = { cotizacion: n, cotizacionFecha: hoyISO() };
  if (datos.config.some((c) => c.id === 'general')) actualizar('config', 'general', cambios);
  else agregar('config', { id: 'general', ...cambios });
  aviso('Cotización actualizada');
}
$$('.btn-cotizacion').forEach((b) => b.addEventListener('click', pedirCotizacion));
function renderCotizacion() {
  const c = cotizacion();
  const texto = c
    ? `US$ 1 = $ ${c.toLocaleString('es-UY', { maximumFractionDigits: 2 })}${configGeneral().cotizacionFecha ? ` (al ${fmtCorto(configGeneral().cotizacionFecha)})` : ''}`
    : 'Sin cotización del dólar: cargala para convertir precios';
  $$('.cotizacion-texto').forEach((el) => { el.textContent = texto; });
}

// ---------- Editor de líneas (productos y servicios) ----------
// Se usa en órdenes (productos, a precio de venta), ventas (productos y servicios) y compras (productos, a costo).
function crearEditorLineas(contenedor, modo) {
  const ed = { lineas: [], moneda: 'UYU', bloqueado: false, alCambiar: null };
  const precioBase = (p) => numero(modo === 'compra' ? p.costo : p.precio);
  const opciones = (sel) => '<option value="">Elegí un producto…</option>' + [...datos.productos]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${escapar(p.nombre)} (stock ${fmtCantidad(numero(p.stock))})</option>`).join('');

  ed.render = () => {
    contenedor.querySelector('.lineas').innerHTML = ed.lineas.map((l, i) => `
      <div class="linea" data-i="${i}">
        ${l.productoId !== null
    ? `<select class="l-prod" ${ed.bloqueado ? 'disabled' : ''}>${opciones(l.productoId)}</select>`
    : `<input class="l-nombre" placeholder="Servicio" value="${escapar(l.nombre)}" maxlength="120">`}
        <input class="l-cant" type="number" inputmode="decimal" step="any" min="0" value="${l.cantidad}" aria-label="Cantidad" ${ed.bloqueado ? 'disabled' : ''}>
        <input class="l-precio" type="number" inputmode="decimal" step="0.01" min="0" value="${l.precio ?? ''}" placeholder="${modo === 'compra' ? 'Costo c/u' : 'Precio c/u'}" aria-label="Precio unitario" ${ed.bloqueado ? 'disabled' : ''}>
        ${ed.bloqueado ? '' : '<button type="button" class="borrar l-quitar" aria-label="Quitar">✕</button>'}
      </div>`).join('');
    contenedor.querySelectorAll('.agregar-producto, .agregar-servicio, .nuevo-producto').forEach((b) => { b.hidden = ed.bloqueado; });
    const bloqueo = contenedor.querySelector('.lineas-bloqueo');
    if (bloqueo) bloqueo.hidden = !ed.bloqueado;
    ed.mostrarTotal();
  };
  ed.mostrarTotal = () => {
    const t = totalLineas(ed.lineas);
    contenedor.querySelector('.total-lineas').textContent = ed.lineas.length ? `Subtotal: ${fmtDinero(t, ed.moneda)}` : '';
    if (ed.alCambiar) ed.alCambiar();
  };
  ed.cargar = (lineas, moneda, bloqueado = false) => {
    ed.lineas = (lineas || []).map((l) => ({ ...l }));
    ed.moneda = moneda;
    ed.bloqueado = bloqueado;
    ed.render();
  };
  // Al cambiar la moneda del documento se convierten los precios ya cargados
  ed.cambiarMoneda = (nueva) => {
    if (nueva === ed.moneda) return;
    if (ed.lineas.some((l) => l.precio != null && l.precio !== '') && !cotizacion()) aviso('Cargá la cotización del dólar para convertir los precios');
    ed.lineas.forEach((l) => {
      if (l.precio == null || l.precio === '') return;
      const c = convertir(numero(l.precio), ed.moneda, nueva);
      if (c != null) l.precio = c;
    });
    ed.moneda = nueva;
    ed.render();
  };
  // Devuelve las líneas listas para guardar, o null (con aviso) si alguna está incompleta
  ed.validas = () => {
    const lineas = ed.lineas.filter((l) => l.productoId || l.nombre || l.precio);
    for (const l of lineas) {
      if (l.productoId === '' || (l.productoId === null && !l.nombre.trim())) { aviso('Hay una línea sin producto o servicio'); return null; }
      if (!(numero(l.cantidad) > 0)) { aviso('Hay una línea con cantidad inválida'); return null; }
    }
    return lineas.map((l) => ({
      productoId: l.productoId || null,
      // si el producto se borró del catálogo se conserva el nombre que tenía la línea
      nombre: l.productoId ? (productoPorId(l.productoId) || l).nombre : l.nombre.trim(),
      cantidad: numero(l.cantidad),
      precio: redondear(numero(l.precio)),
    }));
  };

  contenedor.addEventListener('click', (e) => {
    if (e.target.closest('.agregar-producto')) ed.lineas.push({ productoId: '', nombre: '', cantidad: 1, precio: null });
    else if (e.target.closest('.agregar-servicio')) ed.lineas.push({ productoId: null, nombre: '', cantidad: 1, precio: null });
    else if (e.target.closest('.nuevo-producto')) { abrirFormProducto(null); return; }
    else if (e.target.closest('.l-quitar')) ed.lineas.splice(Number(e.target.closest('.linea').dataset.i), 1);
    else return;
    ed.render();
  });
  contenedor.addEventListener('change', (e) => {
    if (!e.target.classList.contains('l-prod')) return;
    const l = ed.lineas[Number(e.target.closest('.linea').dataset.i)];
    const p = productoPorId(e.target.value);
    l.productoId = e.target.value;
    l.nombre = p ? p.nombre : '';
    if (p) {
      const precio = convertir(precioBase(p), monedaDe(p), ed.moneda);
      if (precio == null) aviso('Cargá la cotización del dólar para convertir el precio');
      l.precio = precio ?? '';
    }
    ed.render();
  });
  // escribir no vuelve a dibujar las líneas (así no se pierde el foco)
  contenedor.addEventListener('input', (e) => {
    const fila = e.target.closest('.linea');
    if (!fila) return;
    const l = ed.lineas[Number(fila.dataset.i)];
    if (e.target.classList.contains('l-cant')) l.cantidad = e.target.value;
    else if (e.target.classList.contains('l-precio')) l.precio = e.target.value;
    else if (e.target.classList.contains('l-nombre')) l.nombre = e.target.value;
    ed.mostrarTotal();
  });
  return ed;
}

// Tabla de líneas para los detalles
function tablaLineas(lineas, moneda) {
  if (!lineas || !lineas.length) return '';
  return `<table class="tabla-lineas"><tbody>${lineas.map((l) => `<tr>
      <td>${escapar(l.nombre)}</td><td class="num">${fmtCantidad(l.cantidad)} × ${fmtDinero(l.precio, moneda)}</td>
      <td class="num">${fmtDinero(redondear(l.cantidad * l.precio), moneda)}</td></tr>`).join('')}</tbody></table>`;
}

const editorOrden = crearEditorLineas($('#lineasOrden'), 'orden');
editorOrden.alCambiar = () => actualizarTotalOrden();
const editorVenta = crearEditorLineas($('#lineasVenta'), 'venta');
const editorCompra = crearEditorLineas($('#lineasCompra'), 'compra');
$('#formVenta').moneda.addEventListener('change', (e) => editorVenta.cambiarMoneda(e.target.value));
$('#formCompra').moneda.addEventListener('change', (e) => editorCompra.cambiarMoneda(e.target.value));

// ---------- Órdenes: stock al marcarlas realizadas ----------
function cambiarRealizada(ev, hecho) {
  const ops = [{
    tipo: 'update',
    col: 'agenda',
    id: ev.id,
    data: { hecho, hechoEn: hecho ? new Date().toISOString() : null, hechoPor: hecho ? miNombre() : null },
  }];
  const productos = lineasDeProductos(ev.lineas);
  if (hecho && !ev.stockDescontado && productos.length) {
    productos.forEach((l) => ops.push({ tipo: 'stock', id: l.productoId, delta: -numero(l.cantidad) }));
    ops[0].data.stockDescontado = true;
  } else if (!hecho && ev.stockDescontado) {
    productos.forEach((l) => ops.push({ tipo: 'stock', id: l.productoId, delta: numero(l.cantidad) }));
    ops[0].data.stockDescontado = false;
  }
  transaccion(ops);
}
// Borrar una orden que ya descontó stock lo devuelve (es deshacerla). Sus cobros quedan en la cuenta del cliente.
function eliminarOrden(ev) {
  const ops = [{ tipo: 'delete', col: 'agenda', id: ev.id }];
  if (ev.stockDescontado) lineasDeProductos(ev.lineas).forEach((l) => ops.push({ tipo: 'stock', id: l.productoId, delta: numero(l.cantidad) }));
  transaccion(ops);
}

// ---------- Productos ----------
$('#buscarProducto').addEventListener('input', renderProductos);
function renderProductos() {
  const busqueda = normalizar($('#buscarProducto').value.trim());
  const lista = datos.productos
    .filter((p) => !busqueda || normalizar(`${p.nombre} ${p.codigo}`).includes(busqueda))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  $('#listaProductos').innerHTML = lista.length
    ? lista.map((p) => {
      const stock = numero(p.stock);
      // rojo sin stock, amarillo en el mínimo o por debajo
      const alerta = stock <= 0 ? 'vencido' : (numero(p.stockMin) && stock <= numero(p.stockMin) ? 'por-vencer' : '');
      return `<li class="item ${alerta}" data-id="${p.id}">
        <div class="info abrir-producto"><div class="principal">${escapar(p.nombre)}</div>
          <div class="sec">${[p.codigo, `Stock: ${fmtCantidad(stock)}`, alerta && (stock <= 0 ? 'sin stock' : 'stock bajo')].filter(Boolean).map(escapar).join(' · ')}</div></div>
        <div class="monto">${p.precio ? fmtDinero(numero(p.precio), monedaDe(p)) : ''}</div>
      </li>`;
    }).join('')
    : `<li class="vacio">${busqueda ? 'No hay productos que coincidan' : 'Todavía no hay productos. Tocá "+ Nuevo producto".'}</li>`;
}

let productoEditando = null;
function abrirFormProducto(p) {
  productoEditando = p ? p.id : null;
  const f = $('#formProducto');
  f.reset();
  $('#dlgProductoTitulo').textContent = p ? 'Editar producto' : 'Nuevo producto';
  ['nombre', 'codigo', 'costo', 'precio', 'stock', 'stockMin'].forEach((k) => { f[k].value = p && p[k] != null ? p[k] : ''; });
  f.moneda.value = p ? monedaDe(p) : 'UYU';
  $('#btnEliminarProducto').hidden = !p;
  $('#dlgProducto').showModal();
}
$('#btnNuevoProducto').addEventListener('click', () => abrirFormProducto(null));
$('#formProducto').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const campos = {
    nombre: f.nombre.value.trim(),
    codigo: f.codigo.value.trim(),
    moneda: f.moneda.value,
    costo: redondear(numero(f.costo.value)),
    precio: redondear(numero(f.precio.value)),
    stockMin: numero(f.stockMin.value),
  };
  if (productoEditando) {
    // editar el stock a mano es un ajuste (inventario, roturas…)
    const anterior = numero(productoPorId(productoEditando).stock);
    const ajuste = numero(f.stock.value) - anterior;
    const ops = [{ tipo: 'update', col: 'productos', id: productoEditando, data: campos }];
    if (ajuste) ops.push({ tipo: 'stock', id: productoEditando, delta: ajuste });
    transaccion(ops);
    aviso('Producto actualizado');
  } else {
    agregar('productos', { id: nuevoId(), ...campos, stock: numero(f.stock.value) });
    aviso('Producto guardado');
  }
  $('#dlgProducto').close();
  // los editores abiertos (por ejemplo una compra) ven el producto nuevo en su lista
  [editorCompra, editorVenta, editorOrden].forEach((ed) => ed.render());
});
$('#btnEliminarProducto').addEventListener('click', () => {
  const p = productoPorId(productoEditando);
  if (!p || !confirm(`¿Eliminar "${p.nombre}"? Las ventas y órdenes que lo usaron conservan el nombre.`)) return;
  eliminar('productos', p.id);
  $('#dlgProducto').close();
});

// ---------- Proveedores ----------
$('#buscarProveedor').addEventListener('input', renderProveedores);
function renderProveedores() {
  const busqueda = normalizar($('#buscarProveedor').value.trim());
  const lista = datos.proveedores
    .filter((p) => !busqueda || normalizar([p.nombre, p.telefono, p.rut].join(' ')).includes(busqueda))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  $('#listaProveedores').innerHTML = lista.length
    ? lista.map((p) => {
      const deuda = Object.entries(saldos(cuentaProveedor(p.id))).filter(([, v]) => v > 0)
        .map(([m, v]) => `Le debés ${fmtDinero(v, m)}`).join(' · ');
      return `<li class="item" data-id="${p.id}">
        <div class="info abrir-proveedor"><div class="principal">${escapar(p.nombre)}</div>
          <div class="sec">${[p.telefono].filter(Boolean).map(escapar).join(' · ')}${deuda ? ` <span class="negativo">${deuda}</span>` : ''}</div></div>
      </li>`;
    }).join('')
    : `<li class="vacio">${busqueda ? 'No hay proveedores que coincidan' : 'Todavía no hay proveedores. Tocá "+ Nuevo proveedor".'}</li>`;
}

let proveedorEditando = null;
function abrirFormProveedor(p) {
  proveedorEditando = p ? p.id : null;
  const f = $('#formProveedor');
  f.reset();
  $('#dlgProveedorTitulo').textContent = p ? 'Editar proveedor' : 'Nuevo proveedor';
  ['nombre', 'telefono', 'email', 'direccion', 'rut', 'notas'].forEach((k) => { f[k].value = p ? p[k] || '' : ''; });
  $('#dlgProveedor').showModal();
}
$('#btnNuevoProveedor').addEventListener('click', () => abrirFormProveedor(null));
$('#formProveedor').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const campos = {};
  ['nombre', 'telefono', 'email', 'direccion', 'rut', 'notas'].forEach((k) => { campos[k] = f[k].value.trim(); });
  if (proveedorEditando) actualizar('proveedores', proveedorEditando, campos);
  else agregar('proveedores', { id: nuevoId(), ...campos });
  aviso('Proveedor guardado');
  $('#dlgProveedor').close();
});

let proveedorVerId = null;
function abrirProveedor(id) {
  proveedorVerId = id;
  renderProveedor();
  $('#dlgVerProveedor').showModal();
}
$('#dlgVerProveedor').addEventListener('close', () => { proveedorVerId = null; });
$('#provEditar').addEventListener('click', () => abrirFormProveedor(proveedorPorId(proveedorVerId)));
$('#provCompra').addEventListener('click', () => abrirCompra(proveedorVerId));
$('#provPago').addEventListener('click', () => abrirPago({ tipo: 'pago', proveedorId: proveedorVerId, titulo: `Pago a ${proveedorPorId(proveedorVerId).nombre}` }));
$('#provEliminar').addEventListener('click', () => {
  const p = proveedorPorId(proveedorVerId);
  if (!p || !confirm(`¿Eliminar a ${p.nombre}? Sus compras y pagos no se borran.`)) return;
  eliminar('proveedores', p.id);
  $('#dlgVerProveedor').close();
});
function renderProveedor() {
  if (!proveedorVerId) return;
  const p = proveedorPorId(proveedorVerId);
  if (!p) { $('#dlgVerProveedor').close(); return; }
  $('#provNombre').textContent = p.nombre;
  $('#provDatos').innerHTML = filasDatos([['Teléfono', p.telefono], ['Correo', p.email], ['Dirección', p.direccion], ['RUT', p.rut], ['Notas', p.notas]]);
  const wa = numeroWhatsApp(p.telefono);
  $('#provContacto').innerHTML = [
    p.telefono && `<a class="boton secundario" href="tel:${escapar(p.telefono.replace(/[^\d+]/g, ''))}">📞 Llamar</a>`,
    wa && `<a class="boton secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>`,
  ].filter(Boolean).join('');
  $('#provCuenta').innerHTML = htmlCuenta(cuentaProveedor(p.id), 'proveedor');
}

// ---------- Compras ----------
function abrirCompra(proveedorId) {
  const f = $('#formCompra');
  f.reset();
  f.proveedorId.innerHTML = '<option value="">Elegí un proveedor…</option>' + [...datos.proveedores]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map((p) => `<option value="${p.id}" ${p.id === proveedorId ? 'selected' : ''}>${escapar(p.nombre)}</option>`).join('');
  f.fecha.value = hoyISO();
  editorCompra.cargar([{ productoId: '', nombre: '', cantidad: 1, precio: null }], f.moneda.value);
  $('#dlgCompra').showModal();
}
$('#formCompra').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const lineas = editorCompra.validas();
  if (!lineas) return;
  if (!lineas.length) { aviso('Agregá al menos un producto'); return; }
  const prov = proveedorPorId(f.proveedorId.value);
  const compra = {
    id: nuevoId(), proveedorId: prov.id, fecha: f.fecha.value, moneda: f.moneda.value,
    lineas, total: totalLineas(lineas), notas: f.notas.value.trim(),
  };
  const ops = [{ tipo: 'set', col: 'compras', id: compra.id, data: compra }];
  lineas.forEach((l) => {
    ops.push({ tipo: 'stock', id: l.productoId, delta: l.cantidad });
    // el costo del producto pasa a ser el de esta compra (en la moneda del producto)
    const p = productoPorId(l.productoId);
    const costo = convertir(l.precio, compra.moneda, monedaDe(p));
    if (costo != null && l.precio) ops.push({ tipo: 'update', col: 'productos', id: p.id, data: { costo } });
  });
  if (f.pagada.checked && compra.total > 0) {
    ops.push(...opsPago({ tipo: 'pago', proveedorId: prov.id, compraId: compra.id, fecha: compra.fecha, moneda: compra.moneda, monto: compra.total, nota: '' }, `Compra a ${prov.nombre}`));
  }
  transaccion(ops);
  aviso('Compra guardada');
  $('#dlgCompra').close();
});

// ---------- Ventas ----------
$('#buscarVenta').addEventListener('input', renderVentas);
$('#btnNuevaVenta').addEventListener('click', () => abrirVenta(null));
function abrirVenta(clienteId) {
  const f = $('#formVenta');
  f.reset();
  f.clienteId.innerHTML = opcionesClientes(clienteId);
  f.fecha.value = hoyISO();
  editorVenta.cargar([], f.moneda.value);
  $('#dlgVenta').showModal();
}
$('#formVenta').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const lineas = editorVenta.validas();
  if (!lineas) return;
  if (!lineas.length) { aviso('Agregá al menos un producto o servicio'); return; }
  const cliente = clientePorId(f.clienteId.value);
  if (!cliente && !f.cobrada.checked) { aviso('Una venta sin cliente tiene que cobrarse en el momento'); return; }
  const venta = {
    id: nuevoId(), clienteId: cliente ? cliente.id : null, fecha: f.fecha.value, moneda: f.moneda.value,
    lineas, total: totalLineas(lineas), notas: f.notas.value.trim(),
  };
  const ops = [{ tipo: 'set', col: 'ventas', id: venta.id, data: venta }];
  lineasDeProductos(lineas).forEach((l) => ops.push({ tipo: 'stock', id: l.productoId, delta: -l.cantidad }));
  if (f.cobrada.checked && venta.total > 0) {
    ops.push(...opsPago({ tipo: 'cobro', clienteId: venta.clienteId, ventaId: venta.id, fecha: venta.fecha, moneda: venta.moneda, monto: venta.total, nota: '' }, `Venta${cliente ? ` a ${cliente.nombre}` : ''}`));
  }
  transaccion(ops);
  aviso('Venta guardada');
  $('#dlgVenta').close();
});

const descripcionVenta = (v) => (v.lineas || []).map((l) => l.nombre).join(', ');
function renderVentas() {
  const busqueda = normalizar($('#buscarVenta').value.trim());
  const lista = datos.ventas
    .filter((v) => !busqueda || normalizar(`${(clientePorId(v.clienteId) || {}).nombre} ${descripcionVenta(v)}`).includes(busqueda))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  $('#listaVentas').innerHTML = lista.length
    ? lista.map((v) => {
      const cliente = clientePorId(v.clienteId);
      const falta = redondear(numero(v.total) - cobradoDe('ventaId', v.id));
      return `<li class="item" data-id="${v.id}">
        <div class="info abrir-doc" data-col="ventas"><div class="principal">${escapar(cliente ? cliente.nombre : 'Venta al contado')}</div>
          <div class="sec">${fmtCorto(v.fecha)} · ${escapar(descripcionVenta(v))}</div>
          ${falta > 0 ? `<div class="sec negativo">Falta cobrar ${fmtDinero(falta, monedaDe(v))}</div>` : ''}</div>
        <div class="monto ingreso">${fmtDinero(numero(v.total), monedaDe(v))}</div>
      </li>`;
    }).join('')
    : `<li class="vacio">${busqueda ? 'No hay ventas que coincidan' : 'Todavía no hay ventas. Tocá "+ Nueva venta".'}</li>`;
}

// ---------- Detalle de venta o compra ----------
let docVer = null; // {col: 'ventas'|'compras', id}
const documentoVer = () => (docVer ? datos[docVer.col].find((d) => d.id === docVer.id) : null);
function abrirDocumento(col, id) {
  docVer = { col, id };
  renderDocumento();
  $('#dlgDoc').showModal();
}
$('#dlgDoc').addEventListener('close', () => { docVer = null; });
function renderDocumento() {
  if (!docVer) return;
  const d = documentoVer();
  if (!d) { $('#dlgDoc').close(); return; }
  const esVenta = docVer.col === 'ventas';
  const quien = esVenta ? clientePorId(d.clienteId) : proveedorPorId(d.proveedorId);
  const pagado = cobradoDe(esVenta ? 'ventaId' : 'compraId', d.id);
  const falta = redondear(numero(d.total) - pagado);
  $('#docTitulo').textContent = `${esVenta ? 'Venta' : 'Compra'} del ${fmtCorto(d.fecha)}`;
  $('#docDatos').innerHTML = filasDatos([
    [esVenta ? 'Cliente' : 'Proveedor', quien ? quien.nombre : (esVenta ? 'Al contado' : '')],
    ['Total', fmtDinero(numero(d.total), monedaDe(d))],
    [esVenta ? 'Cobrado' : 'Pagado', fmtDinero(pagado, monedaDe(d))],
    ['Falta', falta > 0 ? fmtDinero(falta, monedaDe(d)) : ''],
    ['Notas', d.notas],
  ]);
  $('#docLineas').innerHTML = tablaLineas(d.lineas, monedaDe(d));
  $('#docPago').textContent = esVenta ? '💵 Registrar cobro' : '💵 Registrar pago';
  $('#docPago').hidden = !(falta > 0 && quien);
}
$('#docPago').addEventListener('click', () => {
  const d = documentoVer();
  const esVenta = docVer.col === 'ventas';
  const falta = redondear(numero(d.total) - cobradoDe(esVenta ? 'ventaId' : 'compraId', d.id));
  abrirPago(esVenta
    ? { tipo: 'cobro', clienteId: d.clienteId, ventaId: d.id, moneda: monedaDe(d), monto: falta, titulo: 'Cobro de venta' }
    : { tipo: 'pago', proveedorId: d.proveedorId, compraId: d.id, moneda: monedaDe(d), monto: falta, titulo: 'Pago de compra' });
});
// Borrar una venta o compra deshace su stock y borra sus cobros/pagos (y esos movimientos de la caja)
$('#docEliminar').addEventListener('click', () => {
  const d = documentoVer();
  const esVenta = docVer.col === 'ventas';
  if (!d || !confirm(`¿Eliminar esta ${esVenta ? 'venta' : 'compra'}? Se devuelve el stock y se borran sus ${esVenta ? 'cobros' : 'pagos'} de la caja.`)) return;
  const ops = [{ tipo: 'delete', col: docVer.col, id: d.id }];
  lineasDeProductos(d.lineas).forEach((l) => ops.push({ tipo: 'stock', id: l.productoId, delta: esVenta ? l.cantidad : -l.cantidad }));
  datos.pagos.filter((p) => p[esVenta ? 'ventaId' : 'compraId'] === d.id).forEach((p) => ops.push(...opsBorrarPago(p)));
  transaccion(ops);
  $('#dlgDoc').close();
});

// ---------- Cobros y pagos ----------
// Cada cobro (de un cliente) o pago (a un proveedor) genera su movimiento en la caja de Dinero.
function opsPago(pago, descripcion) {
  const p = {
    id: nuevoId(), tipo: pago.tipo, clienteId: pago.clienteId || null, proveedorId: pago.proveedorId || null,
    ventaId: pago.ventaId || null, ordenId: pago.ordenId || null, compraId: pago.compraId || null,
    fecha: pago.fecha, moneda: pago.moneda, monto: redondear(pago.monto), nota: pago.nota || '',
  };
  const mov = {
    id: nuevoId(), tipo: p.tipo === 'cobro' ? 'ingreso' : 'gasto',
    categoria: p.tipo === 'pago' ? 'Proveedores' : (p.ordenId ? 'Servicios' : 'Ventas'),
    monto: p.monto, moneda: p.moneda, fecha: p.fecha, descripcion: descripcion + (p.nota ? ` (${p.nota})` : ''), pagoId: p.id,
  };
  p.movimientoId = mov.id;
  return [{ tipo: 'set', col: 'pagos', id: p.id, data: p }, { tipo: 'set', col: 'movimientos', id: mov.id, data: mov }];
}
const opsBorrarPago = (p) => [{ tipo: 'delete', col: 'pagos', id: p.id }]
  .concat(p.movimientoId && datos.movimientos.some((m) => m.id === p.movimientoId) ? [{ tipo: 'delete', col: 'movimientos', id: p.movimientoId }] : []);

let pagoNuevo = null;
function abrirPago(datosPago) {
  pagoNuevo = datosPago;
  const f = $('#formPago');
  f.reset();
  $('#pagoTitulo').textContent = datosPago.titulo;
  f.moneda.value = datosPago.moneda || 'UYU';
  f.monto.value = datosPago.monto || '';
  f.fecha.value = hoyISO();
  $('#dlgPago').showModal();
}
$('#formPago').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const monto = redondear(numero(f.monto.value));
  if (!(monto > 0)) { aviso('Ingresá un monto válido'); return; }
  const quien = pagoNuevo.tipo === 'cobro' ? clientePorId(pagoNuevo.clienteId) : proveedorPorId(pagoNuevo.proveedorId);
  const descripcion = pagoNuevo.tipo === 'cobro' ? `Cobro a ${quien ? quien.nombre : 'cliente'}` : `Pago a ${quien ? quien.nombre : 'proveedor'}`;
  transaccion(opsPago({ ...pagoNuevo, fecha: f.fecha.value, moneda: f.moneda.value, monto, nota: f.nota.value.trim() }, descripcion));
  aviso(pagoNuevo.tipo === 'cobro' ? 'Cobro registrado' : 'Pago registrado');
  $('#dlgPago').close();
});

// Borrar desde Dinero un movimiento que es un cobro/pago también lo saca del estado de cuenta
function eliminarMovimiento(id) {
  const m = datos.movimientos.find((x) => x.id === id);
  if (!m) return;
  const pago = m.pagoId && datos.pagos.find((p) => p.id === m.pagoId);
  if (!confirm(pago ? `Este movimiento es un ${pago.tipo} registrado en un estado de cuenta. ¿Eliminarlo de los dos lados?` : '¿Eliminar este movimiento?')) return;
  transaccion(pago ? opsBorrarPago(pago) : [{ tipo: 'delete', col: 'movimientos', id }]);
}

// ---------- Estados de cuenta ----------
// Renglones {fecha, concepto, moneda, cargo | abono, pagoId?}; el saldo es cargos − abonos por moneda.
function cuentaCliente(id) {
  const r = [];
  datos.ventas.filter((v) => v.clienteId === id)
    .forEach((v) => r.push({ fecha: v.fecha, concepto: `Venta: ${descripcionVenta(v)}`, moneda: monedaDe(v), cargo: numero(v.total), doc: ['ventas', v.id] }));
  datos.agenda.filter((o) => o.clienteId === id && o.hecho && totalOrden(o) > 0)
    .forEach((o) => r.push({ fecha: o.hechoEn ? fechaLocal(o.hechoEn) : o.fecha, concepto: `Orden: ${o.titulo}`, moneda: monedaDe(o), cargo: totalOrden(o) }));
  datos.pagos.filter((p) => p.tipo === 'cobro' && p.clienteId === id)
    .forEach((p) => r.push({ fecha: p.fecha, concepto: `Cobro${p.nota ? `: ${p.nota}` : ''}`, moneda: monedaDe(p), abono: numero(p.monto), pagoId: p.id }));
  return r.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
function cuentaProveedor(id) {
  const r = [];
  datos.compras.filter((c) => c.proveedorId === id)
    .forEach((c) => r.push({ fecha: c.fecha, concepto: `Compra: ${descripcionVenta(c)}`, moneda: monedaDe(c), cargo: numero(c.total), doc: ['compras', c.id] }));
  datos.pagos.filter((p) => p.tipo === 'pago' && p.proveedorId === id)
    .forEach((p) => r.push({ fecha: p.fecha, concepto: `Pago${p.nota ? `: ${p.nota}` : ''}`, moneda: monedaDe(p), abono: numero(p.monto), pagoId: p.id }));
  return r.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
function saldos(renglones) {
  const s = {};
  renglones.forEach((r) => { s[r.moneda] = redondear((s[r.moneda] || 0) + (r.cargo || 0) - (r.abono || 0)); });
  return s;
}
function htmlCuenta(renglones, quien) {
  if (!renglones.length) return '<p class="vacio">Sin movimientos todavía</p>';
  const s = saldos(renglones);
  const etiqueta = (v, m) => {
    if (Math.abs(v) < 0.005) return `${MONEDAS[m]}: al día ✅`;
    if (quien === 'cliente') return v > 0 ? `<span class="negativo">Debe ${fmtDinero(v, m)}</span>` : `A favor ${fmtDinero(-v, m)}`;
    return v > 0 ? `<span class="negativo">Le debés ${fmtDinero(v, m)}</span>` : `A tu favor ${fmtDinero(-v, m)}`;
  };
  return `<div class="saldos">${Object.entries(s).map(([m, v]) => `<div class="saldo">${etiqueta(v, m)}</div>`).join('')}</div>
    <ul class="lista cuenta">${[...renglones].reverse().map((r) => `<li class="item" ${r.doc ? `data-id="${r.doc[1]}"` : ''}>
      <div class="info ${r.doc ? 'abrir-doc' : ''}" ${r.doc ? `data-col="${r.doc[0]}"` : ''}><div class="principal">${escapar(r.concepto)}</div><div class="sec">${fmtCorto(r.fecha)}</div></div>
      <div class="monto ${r.cargo ? '' : 'ingreso'}">${r.cargo ? fmtDinero(r.cargo, r.moneda) : `−${fmtDinero(r.abono, r.moneda)}`}</div>
      ${r.pagoId ? `<button class="borrar borrar-pago" data-pago="${r.pagoId}" aria-label="Eliminar">✕</button>` : ''}
    </li>`).join('')}</ul>`;
}

// ---------- Clics en listas y fichas ----------
document.addEventListener('click', (e) => {
  const prod = e.target.closest('.abrir-producto');
  if (prod) { abrirFormProducto(productoPorId(prod.closest('[data-id]').dataset.id)); return; }
  const prov = e.target.closest('.abrir-proveedor');
  if (prov) { abrirProveedor(prov.closest('[data-id]').dataset.id); return; }
  const doc = e.target.closest('.abrir-doc');
  if (doc) { abrirDocumento(doc.dataset.col, doc.closest('[data-id]').dataset.id); return; }
  const borrarPago = e.target.closest('.borrar-pago');
  if (borrarPago) {
    const p = datos.pagos.find((x) => x.id === borrarPago.dataset.pago);
    if (p && confirm(`¿Eliminar este ${p.tipo}? También se borra de la caja.`)) transaccion(opsBorrarPago(p));
  }
});

// ---------- Numeración de órdenes ----------
// Las órdenes creadas antes de existir el número se numeran una sola vez, por fecha de creación.
// El orden es determinista: si dos dispositivos lo hacen a la vez escriben los mismos números.
function numerarOrdenesViejas() {
  const sin = datos.agenda.filter((o) => !o.numero);
  if (!sin.length) return;
  let n = siguienteNumeroOrden();
  const clave = (o) => (o.creada || `${o.fecha}T00:00`) + o.id;
  transaccion([...sin].sort((a, b) => clave(a).localeCompare(clave(b)))
    .map((o) => ({ tipo: 'update', col: 'agenda', id: o.id, data: { numero: n++ } })));
}

// ---------- Datos de la empresa (pie de los comprobantes) ----------
// Sin datos cargados: en el espacio propio (TICs de Joaquín) van los de TICs; en uno compartido, su nombre.
const EMPRESA_TICS = { nombre: 'TICs', rut: '160328490016' };
function empresa() {
  const e = configGeneral().empresa;
  if (e && (e.nombre || e.rut)) return e;
  return usuario && espacio && espacio !== usuario.uid ? { nombre: nombreEspacio } : EMPRESA_TICS;
}
function renderEmpresa() {
  const f = $('#formEmpresa');
  if (f.contains(document.activeElement)) return; // no pisar lo que se está escribiendo
  const e = empresa();
  ['nombre', 'rut', 'telefono', 'direccion'].forEach((k) => { f[k].value = e[k] || ''; });
}
$('#formEmpresa').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const datosEmpresa = {};
  ['nombre', 'rut', 'telefono', 'direccion'].forEach((k) => { datosEmpresa[k] = f[k].value.trim(); });
  if (datos.config.some((c) => c.id === 'general')) actualizar('config', 'general', { empresa: datosEmpresa });
  else agregar('config', { id: 'general', empresa: datosEmpresa });
  document.activeElement.blur();
  aviso('Datos guardados');
});

// ---------- Comprobante de orden en PDF ----------
// jsPDF se carga recién cuando hace falta (y el service worker lo guarda para usarlo sin conexión).
// En el celular el PDF se comparte (WhatsApp, correo…); en la PC se descarga.
const URL_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
let promesaPdf = null;
function prepararPdf() {
  if (!promesaPdf) {
    const libreria = window.jspdf ? null : new Promise((ok, mal) => {
      const script = document.createElement('script');
      script.src = URL_JSPDF;
      script.onload = ok;
      script.onerror = mal;
      document.head.appendChild(script);
    });
    const logo = fetch('img/logo-encabezado.png').then((r) => r.blob()).then((b) => new Promise((ok) => {
      const lector = new FileReader();
      lector.onload = () => ok(lector.result);
      lector.readAsDataURL(b);
    }));
    promesaPdf = Promise.all([libreria, logo]).then(([, l]) => l).catch((e) => { promesaPdf = null; throw e; });
  }
  return promesaPdf;
}
const fmtFechaLarga = (iso, mayuscula = true) => {
  const t = parseFecha(iso).toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return mayuscula ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

async function generarComprobante(ev) {
  let logo;
  try { logo = await prepararPdf(); } catch (e) { aviso('No se pudo preparar el PDF. Revisá la conexión.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const mon = monedaDe(ev);
  const cliente = clientePorId(ev.clienteId);
  const emp = empresa();
  const X = 18;
  const DER = 192;
  let y = 16;
  const gris = () => doc.setTextColor(110);
  const negro = () => doc.setTextColor(30);
  const rotulo = (texto) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); gris(); doc.text(texto, X, y); y += 5; negro(); };
  const parrafo = (texto, tam = 10, estilo = 'normal') => {
    doc.setFont('helvetica', estilo); doc.setFontSize(tam);
    const lineas = doc.splitTextToSize(texto, DER - X);
    doc.text(lineas, X, y);
    y += lineas.length * tam * 0.42 + 1.5;
  };

  // Encabezado
  doc.addImage(logo, 'PNG', X, y, 39, 16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); negro();
  doc.text('ORDEN DE TRABAJO', DER, y + 6, { align: 'right' });
  doc.setFontSize(12);
  doc.text(`N.º ${ev.numero ? fmtNumero(ev.numero) : '-'}`, DER, y + 12.5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); gris();
  doc.text(`Emitida el ${fmtFechaLarga(hoyISO(), false)}`, DER, y + 18, { align: 'right' });
  y += 24;
  doc.setDrawColor(220); doc.line(X, y, DER, y);
  y += 8;

  if (cliente) {
    rotulo('CLIENTE');
    parrafo(cliente.nombre, 11, 'bold');
    [cliente.rut && `RUT: ${cliente.rut}`, cliente.telefono && `Tel.: ${cliente.telefono}`, cliente.direccion].filter(Boolean)
      .forEach((t) => parrafo(t, 10));
    y += 3;
  }
  rotulo('TRABAJO A REALIZAR');
  parrafo(ev.titulo, 11, 'bold');
  if (ev.nota) parrafo(ev.nota, 10);
  y += 3;
  rotulo('FECHA DE ENTREGA');
  parrafo(fmtFechaLarga(ev.fecha) + (ev.hora ? ` - ${ev.hora} h` : ''), 10);
  y += 4;

  // Detalle de costos: servicio + productos
  const filas = [];
  if (numero(ev.precio) > 0) filas.push({ nombre: 'Servicio / mano de obra', cantidad: 1, precio: numero(ev.precio) });
  (ev.lineas || []).forEach((l) => filas.push(l));
  if (filas.length) {
    const COL = { cant: 128, unit: 158 };
    doc.setFillColor(240, 241, 245); doc.rect(X, y - 4.5, DER - X, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); negro();
    doc.text('Descripción', X + 2, y); doc.text('Cant.', COL.cant, y, { align: 'right' });
    doc.text('Precio unit.', COL.unit, y, { align: 'right' }); doc.text('Importe', DER - 2, y, { align: 'right' });
    y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    filas.forEach((f) => {
      const desc = doc.splitTextToSize(f.nombre, COL.cant - X - 20);
      if (y + desc.length * 4.5 > 265) { doc.addPage(); y = 20; }
      doc.text(desc, X + 2, y);
      doc.text(fmtCantidad(f.cantidad), COL.cant, y, { align: 'right' });
      doc.text(fmtDinero(numero(f.precio), mon), COL.unit, y, { align: 'right' });
      doc.text(fmtDinero(redondear(numero(f.cantidad) * numero(f.precio)), mon), DER - 2, y, { align: 'right' });
      y += desc.length * 4.5 + 2;
      doc.setDrawColor(235); doc.line(X, y - 3, DER, y - 3);
    });
    y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(`TOTAL  ${fmtDinero(totalOrden(ev), mon)}`, DER - 2, y, { align: 'right' });
  }

  // Pie con los datos de la empresa, en todas las páginas
  const pie = [emp.nombre, emp.rut && `RUT ${emp.rut}`, emp.telefono && `Tel. ${emp.telefono}`, emp.direccion].filter(Boolean).join('  ·  ');
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    doc.setDrawColor(220); doc.line(X, 282, DER, 282);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); gris();
    doc.text(pie, (X + DER) / 2, 287, { align: 'center' });
  }

  const archivo = `Orden-${fmtNumero(ev.numero || 0)}${cliente ? `-${cliente.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-')}` : ''}.pdf`;
  const blob = doc.output('blob');
  const file = new File([blob], archivo, { type: 'application/pdf' });
  const esCelular = matchMedia('(pointer: coarse)').matches;
  if (esCelular && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Orden de trabajo N.º ${fmtNumero(ev.numero || 0)}` });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // el usuario cerró el menú de compartir
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = archivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  aviso('Comprobante descargado');
}
$('#detComprobante').addEventListener('click', () => {
  const ev = eventoDetalle();
  if (ev) generarComprobante(ev);
});
// al abrir una orden se precarga el generador, así compartir es inmediato
document.addEventListener('click', (e) => { if (e.target.closest('.abrir-detalle')) prepararPdf().catch(() => {}); });

// ---------- Render ----------
function renderComercio() {
  renderEmpresa();
  renderCotizacion();
  renderProductos();
  renderProveedores();
  renderVentas();
  renderProveedor();
  renderDocumento();
}

// ---------- Arranque (los dos archivos ya están cargados) ----------
render();
// los colores de vencimiento dependen de la hora: se recalculan cada minuto
setInterval(render, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
