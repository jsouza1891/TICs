// Exploración temporal: muestra cómo viene la página de cotizaciones del BROU (se borra después)
const URL_BROU = 'https://www.brou.com.uy/cotizaciones';
const r = await fetch(URL_BROU, { headers: { 'User-Agent': 'Mozilla/5.0 (TICS APP cotizaciones)' } });
const html = await r.text();
console.log('estado', r.status, 'largo', html.length);
for (const m of html.matchAll(/<(iframe|script)[^>]+src="([^"]+)"/g)) console.log('src', m[1], m[2]);
for (const m of html.matchAll(/https?:[^"' ]*(cotiz|portlet|json|api)[^"' ]*/gi)) console.log('url', m[0]);
let i = 0;
for (const m of html.matchAll(/D[óo]lar/g)) {
  if (i++ > 6) break;
  console.log('--- alrededor de', m.index, '---\n' + html.slice(Math.max(0, m.index - 400), m.index + 800).replace(/\s+/g, ' '));
}
