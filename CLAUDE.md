# Notas del proyecto: Mi Asistente Personal

App personal de agenda, gastos e ingresos. El usuario la usa a diario en un celular Android (instalada como PWA desde Chrome) y en la PC (Chrome). Se habla en español rioplatense (Uruguay). Se mejora de a poco según el uso: cambios chicos, probados y publicados.

## Cómo está hecha
- HTML, CSS y JavaScript puro, sin build ni dependencias: `index.html`, `styles.css`, `app.js`.
- `sw.js`: service worker con estrategia "red primero" para que funcione sin conexión. Solo intercepta archivos propios y el SDK de Firebase (www.gstatic.com); nunca las conexiones de Firestore ni del login. Al cambiar la lista de archivos, subir la versión de `CACHE`.
- Montos con formato `es-UY` ($1.500,00). Fechas guardadas como `YYYY-MM-DD` en hora local.

## Publicación
- GitHub Pages desde la rama `main`, carpeta raíz: https://jsouza1891.github.io/TICs/
- Se trabaja en la rama de la sesión y se publica empujando a `main`. Tras publicar, el usuario cierra y abre la app en el celular y recarga con Ctrl+Shift+R en la PC (la caché vieja ya causó confusiones una vez).

## Sincronización (Firebase)
- Proyecto Firebase `app-asistente-565dd`, configuración en `firebase-config.js` (no es secreta).
- Inicio de sesión con Google (Firebase Auth). Dominio autorizado agregado a mano: `jsouza1891.github.io`.
- Firestore, base `(default)`, región southamerica-east1. Datos en `usuarios/{uid}/agenda/{id}` y `usuarios/{uid}/movimientos/{id}`, un documento por elemento.
- Sin sesión, los datos van a `localStorage`. Al iniciar sesión por primera vez en un dispositivo se suben los datos locales. La clave `-dueno` en localStorage evita volver a subirlos y revivir elementos borrados desde otro equipo. Al cerrar sesión se borra la copia local.
- La sección Resumen → Sincronización muestra el estado (✅ conectado / ⏳ conectando / ⚠️ código de error). Es la primera herramienta para diagnosticar problemas.
- **Reglas publicadas en la consola**: como `firestore.rules`, pero además solo permiten el correo del usuario (`request.auth.token.email == '<correo>'` y `email_verified`). El correo NO se escribe en el repo porque es público. Si se agrega alguien, se suma su correo en la consola.
- Firebase y las reglas se cambian a mano en la consola: desde acá no hay acceso. Darle al usuario links directos, por ejemplo https://console.firebase.google.com/project/app-asistente-565dd/firestore/rules

## Funcionalidades y decisiones
- **Pestañas: Agenda | Dinero | Cuenta.** La parte económica está separada a propósito: el usuario muestra o comparte tareas con otras personas y no quiere que vean su dinero. La app abre en Agenda, y nada económico debe aparecer en esa pestaña.
- **Cuenta**: sincronización y respaldo (exportar/importar JSON).
- **Agenda** (pestaña inicial): área Personal o Laboral (campo `area`; los elementos sin el campo cuentan como personales), con filtros Todas/Personal/Laboral. Colores: amarillo si vence en 24 h o menos, rojo si ya venció. El vencimiento es la hora indicada o fin del día si no tiene hora. Se recalcula cada minuto.
- **Dinero**: selector de mes (solo visible en esta pestaña), resumen del mes (ingresos, gastos, balance, gastos por categoría) y movimientos. Categorías de gasto pedidas por el usuario: Personal, Comida, Servicios, Ocio, Proveedores, Ventas, Otros. De ingreso: Sueldo, Ventas, Servicios, Otros. Los movimientos viejos conservan su categoría aunque ya no esté en la lista.

## Ideas pendientes ofrecidas (no pedidas todavía)
Aviso de versión nueva, editar eventos y movimientos, categorías personalizables, gastos fijos mensuales, presupuesto por categoría, recordatorios con notificación, gráfico de evolución mensual.
