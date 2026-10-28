# Mi Asistente Personal

App web (PWA) para llevar en un solo lugar:

- **Agenda**: eventos y tareas con fecha, hora y nota; se marcan como hechos y se agrupan por día (los atrasados se señalan).
- **Gastos e ingresos**: monto, categoría, fecha y descripción; filtro por tipo y navegación por mes.
- **Resumen mensual**: total de ingresos, gastos, balance, gastos por categoría y próximos eventos.
- **Respaldo**: exportar e importar todos los datos en un archivo JSON.

No necesita servidor ni instalación de dependencias: es HTML, CSS y JavaScript puro.
Los datos se guardan en el navegador del dispositivo (`localStorage`). Opcionalmente, iniciando sesión con Google
se sincronizan entre dispositivos con Firebase (Firestore); la configuración está en `firebase-config.js`
y las reglas de seguridad en `firestore.rules`.

## Cómo usarla

Abrí `index.html` en el navegador, o servila localmente para que funcione sin conexión e instalable:

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

Para usarla en el celular, publicala en GitHub Pages (Settings → Pages → rama del repo)
y desde el navegador del teléfono elegí **"Agregar a pantalla de inicio"**.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de las tres pantallas |
| `styles.css` | Estilos (modo claro/oscuro, diseño para celular) |
| `app.js` | Lógica: guardar, listar, borrar, resumen, respaldo |
| `sw.js` | Service worker para uso sin conexión |
| `manifest.webmanifest`, `img/` | Datos e íconos (logo de TICs) para instalarla como app |
