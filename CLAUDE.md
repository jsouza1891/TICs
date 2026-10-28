# Notas del proyecto: Mi Asistente Personal

App personal de agenda, gastos e ingresos. El usuario la usa a diario en un celular Android (instalada como PWA desde Chrome) y en la PC (Chrome). Se habla en español rioplatense (Uruguay). Se mejora de a poco según el uso: cambios chicos, probados y publicados.

## Cómo está hecha
- HTML, CSS y JavaScript puro, sin build ni dependencias: `index.html`, `styles.css`, `app.js`.
- `sw.js`: service worker con estrategia "red primero" para que funcione sin conexión. Solo intercepta archivos propios y el SDK de Firebase (www.gstatic.com); nunca las conexiones de Firestore ni del login. Al cambiar la lista de archivos, subir la versión de `CACHE`.
- Montos con formato `es-UY` ($1.500,00). Fechas guardadas como `YYYY-MM-DD` en hora local.

## Publicación
- GitHub Pages desde la rama `main`, carpeta raíz, con dominio propio **https://app.tics.com.uy** (archivo `CNAME`; el link viejo jsouza1891.github.io/TICs redirige solo).
- DNS: el dominio tics.com.uy está registrado en Antel (Vera) con nameservers de Spaceship; los registros se editan en Spaceship → Administrador de Hosting → tics.com.uy → "DNS avanzado". Ahí hay un CNAME `app` → `jsouza1891.github.io`. Los registros del grupo "Web Hosting" son de su página y FTP: no tocarlos.
- `app.tics.com.uy` también está en los dominios autorizados de Firebase Auth.
- Se trabaja en la rama de la sesión y se publica empujando a `main`. Tras publicar, el usuario cierra y abre la app en el celular y recarga con Ctrl+Shift+R en la PC (la caché vieja ya causó confusiones una vez).

## Sincronización (Firebase)
- Proyecto Firebase `app-asistente-565dd`, configuración en `firebase-config.js` (no es secreta).
- **Inicio de sesión obligatorio**: la app abre en una pantalla de login (`body[data-estado]`: cargando / login / app) y solo muestra datos con sesión. Métodos: correo y contraseña, o Google. El usuario (Joaquín) entra con Google; los demás (por ejemplo su hermano) con usuario y contraseña creados por él en Firebase → Authentication → Usuarios → Agregar usuario. No hay registro desde la app y el registro público está deshabilitado en la consola ("Acciones del usuario"). "Olvidé mi contraseña" y "Cambiar contraseña" usan `sendPasswordResetEmail`.
- **Usuarios sin correo**: en el login se puede escribir solo un nombre ("juan"); la app lo convierte en `juan@usuarios.tics.com.uy` (dominio que no recibe mails). El admin los crea en Authentication con ese correo interno. No tienen "olvidé mi contraseña": la cambian ellos desde Cuenta (reautenticación + `updatePassword`) o el admin borra y recrea el usuario (en espacios compartidos no se pierde nada porque la ficha `miembros` va por correo, no por uid).
- **Espacios**: los datos cuelgan de `usuarios/{espacio}`. Por defecto el espacio es el propio uid (así está Joaquín). Para compartir, el admin crea en Firestore una ficha `miembros/{correo en minúsculas}` con `{espacio: 'id-del-espacio', nombre: 'Nombre visible'}`; todos los que tengan la misma ficha ven y cargan los mismos datos (todo: agenda y dinero). Caso real: el hermano de Joaquín y su socio comparten el espacio de su empresa. La app guarda el último espacio en localStorage para abrir sin conexión. Cada elemento guarda `autor` (y `hechoPor`, y `autor` en cada actualización); se muestra solo si lo cargó otra persona. Dominios autorizados agregados a mano: `jsouza1891.github.io` y `app.tics.com.uy`.
- Firestore, base `(default)`, región southamerica-east1. Datos en `usuarios/{uid}/agenda/{id}` y `usuarios/{uid}/movimientos/{id}`, un documento por elemento.
- Hay una copia local en `localStorage` (y la cache offline de Firestore). Al iniciar sesión por primera vez en un dispositivo se suben los datos locales. La clave `-dueno` en localStorage evita volver a subirlos y revivir elementos borrados desde otro equipo. Al cerrar sesión se borra la copia local.
- La sección Cuenta → Sincronización muestra el estado (✅ conectado / ⏳ conectando / ⚠️ código de error). Es la primera herramienta para diagnosticar problemas.
- **Reglas publicadas en la consola**: iguales a `firestore.rules` con el correo real del admin en lugar de `CORREO_DEL_ADMIN` (los correos NO se escriben en el repo porque es público). Espacio propio: uid == espacio y correo en la lista. Espacio compartido: la ficha `miembros/{correo}` lo autoriza. No se exige `email_verified` porque los usuarios con contraseña creados en la consola no están verificados; por eso es clave que el registro público esté deshabilitado.
- Sumar un usuario con espacio propio: crearlo en Authentication y agregar su correo a la lista de las reglas. Sumar a un espacio compartido: crearlo en Authentication y crear su ficha en `miembros`.
- Firebase y las reglas se cambian a mano en la consola: desde acá no hay acceso. Darle al usuario links directos, por ejemplo https://console.firebase.google.com/project/app-asistente-565dd/firestore/rules

## Marca
- Logo de la empresa del usuario (TICs, "Tecnología a medida"): fondo gris oscuro #373e46, letras blancas y amarillo #fcb817. Está en `img/`: íconos de la app (versiones normal y "maskable" con margen para que Android no corte el texto) y `logo-encabezado.png` (solo "TICs", sin el lema, porque a 36 px no se lee) en el encabezado. Para regenerarlos se parte de la imagen original cuadrada con Pillow.

## Funcionalidades y decisiones
- **Pestañas: Agenda | Dinero | Cuenta.** La parte económica está separada a propósito: el usuario muestra o comparte tareas con otras personas y no quiere que vean su dinero. La app abre en Agenda, y nada económico debe aparecer en esa pestaña.
- **Cuenta**: sincronización y respaldo (exportar/importar JSON).
- **Agenda** (pestaña inicial): área Personal o Laboral (campo `area`; los elementos sin el campo cuentan como personales), con filtros Todas/Personal/Laboral. Colores: amarillo si vence en 24 h o menos, rojo si ya venció. El vencimiento es la hora indicada o fin del día si no tiene hora. Se recalcula cada minuto. La usa sobre todo como agenda de trabajo: tocando una tarea se abre el detalle (`<dialog>`) con la bitácora `actualizaciones` (`[{id, texto, fecha ISO}]`, se agregan y borran) y "Trabajo realizado", que guarda `hechoEn` (fecha ISO de cuando se terminó). La lista muestra 💬 cantidad y la última actualización.
- **Dinero**: selector de mes (solo visible en esta pestaña), resumen del mes (ingresos, gastos, balance, gastos por categoría) y movimientos. Categorías de gasto pedidas por el usuario: Personal, Comida, Servicios, Ocio, Proveedores, Ventas, Otros. De ingreso: Sueldo, Ventas, Servicios, Otros. Los movimientos viejos conservan su categoría aunque ya no esté en la lista.

## Ideas pendientes ofrecidas (no pedidas todavía)
Aviso de versión nueva, editar eventos y movimientos, categorías personalizables, gastos fijos mensuales, presupuesto por categoría, recordatorios con notificación, gráfico de evolución mensual.
