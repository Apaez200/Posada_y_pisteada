"use strict";
/* Interfaz de la tanda. Los datos vienen de backend.js (crearBackend). */

const PAG_ADMIN = document.body.dataset.admin === "1";
const INICIO = "2026-11-09"; // lunes 9 de noviembre
const FIN = "2026-12-18";    // viernes 18 de diciembre
const PAGO_DIA = 10;
const LETRAS = ["D", "L", "M", "M", "J", "V", "S"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
const dinero = (n) => "$" + n.toLocaleString("es-MX");
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  hijos.forEach((h) => e.append(h));
  return e;
}
const aFecha = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const aIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoyIso = () => aIso(new Date());

// Días hábiles (lun-vie) entre INICIO y FIN
function diasHabiles() {
  const out = [];
  const fin = aFecha(FIN);
  for (let d = aFecha(INICIO); d <= fin; d.setDate(d.getDate() + 1)) {
    if (d.getDay() >= 1 && d.getDay() <= 5) out.push(aIso(d));
  }
  return out;
}
// Agrupa por semana (lunes a viernes)
function semanas(dias) {
  const mapa = new Map();
  for (const iso of dias) {
    const d = aFecha(iso);
    const lunes = new Date(d); lunes.setDate(d.getDate() - (d.getDay() - 1));
    const k = aIso(lunes);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(iso);
  }
  return [...mapa.values()];
}

// ---------- Estado ----------
let estado = { personas: [] };
let esAdmin = false;
let backend = null;
let ultimoToggle = "";     // para animar solo el día recién marcado
let yaPintado = false;
let confetiHecho = false;

function mostrarAviso(t) { const a = $("aviso"); a.textContent = t; a.hidden = !t; }

async function guardar() {
  try { await backend.guardar(estado); mostrarAviso(""); }
  catch { mostrarAviso("⚠️ No se pudo guardar. Revisa tu conexión o vuelve a iniciar sesión."); }
}

const pagado = (p) => p.dias.length * PAGO_DIA;
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");

// ---------- Render ----------
function render() {
  if (!backend) return;
  const dias = diasHabiles();
  const meta = dias.length * PAGO_DIA;
  const hoy = hoyIso();

  animarNumero($("totalGeneral"), estado.personas.reduce((s, p) => s + pagado(p), 0));
  animarNumero($("metaPersona"), meta);
  animarNumero($("diasRestantes"), dias.filter((d) => d >= hoy).length, String);
  if (PAG_ADMIN) {
    $("loginBox").hidden = esAdmin;
    $("contenido").hidden = !esAdmin;
  }

  // Público: ranking por lo pagado. Admin: orden alfabético fijo (no saltan al marcar).
  const orden = [...estado.personas].sort(PAG_ADMIN ? porNombre : (a, b) => pagado(b) - pagado(a) || porNombre(a, b));
  if (!PAG_ADMIN) {
    renderArbol(estado.personas.reduce((s, p) => s + pagado(p), 0), estado.personas.length * meta);
    renderHoy(dias, hoy);
    renderPodio(orden);
  }

  const lista = $("lista");
  if (!estado.personas.length) {
    lista.replaceChildren(el("p", { className: "vacio", textContent: "Aún no hay participantes 🎅" }));
    return;
  }
  const abiertos = new Set([...lista.querySelectorAll("details[open]")].map((d) => d.dataset.id));
  const animar = !PAG_ADMIN && !yaPintado;
  yaPintado = true;
  lista.replaceChildren(...orden.map((p, i) => tarjeta(p, dias, meta, hoy, abiertos.has(p.id), i, animar)));

  if (!PAG_ADMIN && !confetiHecho && meta && orden.some((p) => pagado(p) >= meta)) {
    confetiHecho = true;
    lanzarConfeti();
  }
}

function tarjeta(p, dias, meta, hoy, abierto, rango, animar) {
  const total = pagado(p);
  const pct = meta ? Math.min(100, (total / meta) * 100) : 0;
  const pagados = new Set(p.dias);
  const medalla = !PAG_ADMIN && total > 0 && rango < 3 ? ["🥇", "🥈", "🥉"][rango] + " " : "";

  const top = el("div", { className: "persona-top" },
    el("span", { className: "nombre", textContent: medalla + p.nombre }),
    el("span", { className: "monto", textContent: `${dinero(total)} / ${dinero(meta)}` }));

  const barra = el("div", { className: "barra", title: `${Math.round(pct)}%` },
    el("div", { className: pct >= 100 ? "completo" : "", style: `width:${pct}%` }));
  const trineo = el("span", {
    className: "trineo", ariaHidden: "true", textContent: pct >= 100 ? "🎅" : "🛷",
    style: `left:calc(${pct}% - ${(pct * 0.26).toFixed(1)}px)`,
  });
  const pista = el("div", { className: "pista" }, barra, trineo);
  const etiqueta = el("div", { className: "pct", textContent: pct >= 100 ? "🎉 ¡Tanda completa!" : `${Math.round(pct)}% completado` });

  const insignias = el("div", { className: "insignias" });
  if (pct < 100) {
    const pasados = dias.filter((d) => d < hoy);
    const n = racha(p, dias, hoy);
    if (pasados.length && pasados.every((d) => pagados.has(d))) insignias.append(el("span", { className: "ins ok", textContent: "✅ Al corriente" }));
    if (n >= 3) insignias.append(el("span", { className: "ins fuego", textContent: `🔥 ${n} días seguidos` }));
  }

  const filas = semanas(dias).map((sem) => {
    const celdas = sem.map((iso) => {
      const d = aFecha(iso);
      const ok = pagados.has(iso);
      const cls = "dia" + (ok ? " ok" : iso < hoy ? " falta" : "") + (iso === hoy ? " hoy" : "") +
                  (ultimoToggle === p.id + iso ? " pop" : "");
      const b = el("button", {
        type: "button", className: cls, disabled: !esAdmin,
        title: `${d.getDate()} ${MESES[d.getMonth()]}`,
        ariaLabel: `${d.getDate()} de ${MESES[d.getMonth()]}: ${ok ? "pagado" : "sin pagar"}`,
      }, el("small", { textContent: LETRAS[d.getDay()] }), String(d.getDate()));
      if (esAdmin) b.addEventListener("click", () => {
        p.dias = ok ? p.dias.filter((x) => x !== iso) : [...p.dias, iso];
        ultimoToggle = p.id + iso;
        render(); guardar();
      });
      return b;
    });
    const d0 = aFecha(sem[0]);
    const fila = el("div", { className: "semana" },
      el("span", { className: "sem-et", textContent: `Semana del ${d0.getDate()} ${MESES[d0.getMonth()]}` }),
      el("div", { className: "dias" }, ...celdas));
    if (esAdmin) {
      const todos = sem.every((x) => pagados.has(x));
      const bs = el("button", {
        type: "button", className: "sem-btn " + (todos ? "gris" : "sec"),
        textContent: todos ? "Quitar semana" : `Pagar semana (${dinero(sem.length * PAGO_DIA)})`,
      });
      bs.addEventListener("click", () => {
        p.dias = todos ? p.dias.filter((x) => !sem.includes(x)) : [...new Set([...p.dias, ...sem])];
        ultimoToggle = "";
        render(); guardar();
      });
      fila.append(bs);
    }
    return fila;
  });

  const resumen = el("summary", { textContent: `Ver calendario (${p.dias.length} de ${dias.length} días)` });
  const det = el("details", { open: abierto }, resumen, ...filas);
  det.dataset.id = p.id;

  const hijos = [top, pista, etiqueta, ...(insignias.childElementCount ? [insignias] : []), det];
  if (esAdmin) {
    const del = el("button", { type: "button", className: "peq gris", textContent: "🗑 Eliminar", title: "Eliminar participante" });
    del.addEventListener("click", () => {
      if (confirm(`¿Eliminar a ${p.nombre} y todos sus pagos?`)) {
        estado.personas = estado.personas.filter((x) => x.id !== p.id);
        render(); guardar();
      }
    });
    hijos.push(del);
  }
  const card = el("div", { className: "persona" + (pct >= 100 ? " campeon" : "") + (animar ? " entra" : "") }, ...hijos);
  if (animar) card.style.animationDelay = `${rango * 90}ms`;
  return card;
}

// Días seguidos pagados hasta hoy (si hoy aún no paga, no rompe la racha)
function racha(p, dias, hoy) {
  const set = new Set(p.dias);
  const pasados = dias.filter((d) => d <= hoy);
  let i = pasados.length - 1;
  if (i >= 0 && pasados[i] === hoy && !set.has(hoy)) i--;
  let n = 0;
  while (i >= 0 && set.has(pasados[i])) { n++; i--; }
  return n;
}

// ---------- Secciones exclusivas de la página pública ----------
const DIAS_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function renderHoy(dias, hoy) {
  const t = $("hoyTxt");
  if (!t) return;
  const d = aFecha(hoy);
  const fecha = `${DIAS_LARGO[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  const total = estado.personas.length;
  if (hoy < INICIO) t.textContent = "⏳ La tanda arranca el lunes 9 de noviembre.";
  else if (hoy > FIN) t.textContent = "🎉 ¡La tanda terminó! Gracias a todos.";
  else if (!dias.includes(hoy)) t.textContent = `😴 Hoy es ${fecha}: día de descanso. ¡Nos vemos el lunes!`;
  else {
    const n = estado.personas.filter((p) => p.dias.includes(hoy)).length;
    t.textContent = `📅 Hoy ${fecha}: han pagado ${n} de ${total}` + (total && n === total ? " 🎉 ¡Todos!" : "");
  }
}

function renderPodio(orden) {
  const card = $("podioCard");
  if (!card) return;
  const top = orden.filter((p) => pagado(p) > 0).slice(0, 3);
  card.hidden = top.length === 0;
  if (!top.length) return;
  const medallas = ["🥇", "🥈", "🥉"];
  // Disposición clásica de podio: 2º - 1º - 3º
  const lugares = [1, 0, 2].filter((i) => top[i]);
  $("podio").replaceChildren(...lugares.map((i) =>
    el("div", { className: `pod lugar${i + 1}` },
      el("span", { className: "pod-med", textContent: medallas[i] }),
      el("span", { className: "pod-nom", textContent: top[i].nombre }),
      el("div", { className: "escalon", textContent: dinero(pagado(top[i])) }))));
}

// Árbol de Navidad: se ilumina según lo juntado por todo el grupo
const SVGNS = "http://www.w3.org/2000/svg";
const ADORNOS = 28;
let arbol = null;

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function construirArbol() {
  const s = svgEl("svg", { viewBox: "0 0 240 275", class: "arbol-svg", "aria-hidden": "true" });
  s.append(
    svgEl("rect", { x: 106, y: 222, width: 28, height: 34, rx: 3, fill: "#6b4423" }),
    svgEl("polygon", { points: "120,26 60,122 180,122", fill: "#1f7a45" }),
    svgEl("polygon", { points: "120,68 44,172 196,172", fill: "#176b3b" }),
    svgEl("polygon", { points: "120,108 28,226 212,226", fill: "#0f5a30" }));
  const estrella = svgEl("polygon", {
    class: "estrella",
    points: "120,2 126,18 143,18 129,28 134,45 120,35 106,45 111,28 97,18 114,18",
  });
  s.append(estrella);

  const ancho = (y) => Math.max(y <= 122 ? 60 * (y - 26) / 96 : 0, y > 68 && y <= 172 ? 76 * (y - 68) / 104 : 0, y > 108 ? 92 * (y - 108) / 118 : 0);
  const colores = ["#ff4d4d", "#f2c14e", "#4da6ff", "#ff8fd1", "#ffffff", "#4dff88"];
  const filas = [62, 88, 114, 140, 163, 188, 210];
  const adornos = [];
  let semilla = 7;
  const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  filas.forEach((y, r) => {
    const n = r + 1, w = ancho(y) * 0.74;
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 120 : 120 - w + (2 * w * k) / (n - 1);
      const c = colores[adornos.length % colores.length];
      const o = svgEl("circle", {
        cx: (x + (azar() - 0.5) * 4).toFixed(1), cy: (y + (azar() - 0.5) * 4).toFixed(1), r: 5.5,
        class: "orn", style: `--c:${c};animation-delay:${(azar() * 2).toFixed(2)}s`,
      });
      s.append(o);
      adornos.push(o);
    }
  });
  // Orden (aleatorio pero fijo) en que se van encendiendo
  const prioridad = adornos.map((_, i) => i).sort(() => azar() - 0.5);
  $("arbol").replaceChildren(s);
  return { adornos, estrella, prioridad };
}

function renderArbol(pagadoTotal, metaTotal) {
  if (!$("arbol")) return;
  if (!arbol) arbol = construirArbol();
  const pct = metaTotal ? Math.min(1, pagadoTotal / metaTotal) : 0;
  const n = pagadoTotal > 0 ? Math.max(1, Math.round(pct * ADORNOS)) : 0;
  arbol.adornos.forEach((o, i) => o.classList.toggle("on", arbol.prioridad.indexOf(i) < n));
  arbol.estrella.classList.toggle("on", pct >= 1);
  $("arbolTxt").textContent = metaTotal
    ? `${Math.round(pct * 100)}% iluminado · ${dinero(pagadoTotal)} de ${dinero(metaTotal)}` +
      (pct >= 1 ? " ⭐ ¡Árbol completo!" : "")
    : "Aquí aparecerá el árbol cuando haya participantes.";
}

// Regalo de bienvenida (una vez por visita)
function intro() {
  if (PAG_ADMIN || sinMovimiento) return;
  try { if (sessionStorage.getItem("tanda-intro")) return; sessionStorage.setItem("tanda-intro", "1"); }
  catch { /* sin sessionStorage: se muestra siempre */ }
  const b = el("button", { type: "button", className: "intro", ariaLabel: "Abrir el regalo y entrar" },
    el("span", { className: "regalo", ariaHidden: "true", textContent: "🎁" }),
    el("span", { className: "intro-t", textContent: "Tanda Navideña" }),
    el("span", { className: "intro-s", textContent: "Toca para abrir tu regalo" }));
  document.body.append(b);
  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    b.classList.add("sale");
    lanzarConfeti();
    setTimeout(() => b.remove(), 700);
  };
  b.addEventListener("click", cerrar);
  setTimeout(cerrar, 7000);
}

// ---------- Efectos ----------
const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function animarNumero(nodo, valor, fmt = dinero) {
  const desde = nodo._v ?? 0;
  nodo._v = valor;
  if (sinMovimiento || desde === valor) { nodo.textContent = fmt(valor); return; }
  cancelAnimationFrame(nodo._raf);
  const t0 = performance.now(), dur = 900;
  const paso = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    nodo.textContent = fmt(Math.round(desde + (valor - desde) * e));
    if (k < 1) nodo._raf = requestAnimationFrame(paso);
  };
  nodo._raf = requestAnimationFrame(paso);
}

function lanzarConfeti() {
  if (sinMovimiento) return;
  const c = el("canvas", { className: "confeti", ariaHidden: "true" });
  c.width = innerWidth; c.height = innerHeight;
  document.body.append(c);
  const g = c.getContext("2d");
  if (!g) { c.remove(); return; }
  const cols = ["#b3202a", "#165b33", "#f2c14e", "#ffffff", "#e8505b"];
  const cantidad = innerWidth < 600 ? 80 : 140;
  const ps = Array.from({ length: cantidad }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5,
    vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 4,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
    c: cols[Math.floor(Math.random() * cols.length)],
  }));
  const fin = performance.now() + 5000;
  (function frame(t) {
    g.clearRect(0, 0, c.width, c.height);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (t < fin) requestAnimationFrame(frame); else c.remove();
  })(performance.now());
}

function lucesNavidenas() {
  const h = document.querySelector(".hero");
  if (!h) return;
  const cont = el("div", { className: "luces", ariaHidden: "true" });
  const n = Math.ceil(innerWidth / 36);
  for (let i = 0; i < n; i++) {
    cont.append(el("span", { style: `--c:${["#ff4d4d", "#f2c14e", "#4dff88", "#4da6ff"][i % 4]};animation-delay:${(i % 4) * 0.4}s` }));
  }
  h.prepend(cont);
}

function cuentaRegresiva() {
  const c = $("cuenta");
  if (!c) return;
  const f = aFecha(FIN); f.setHours(23, 59, 59);
  const caja = (n, t) => el("div", { className: "caja" }, el("b", { textContent: String(n).padStart(2, "0") }), el("small", { textContent: t }));
  const act = () => {
    const ms = f - new Date();
    if (ms <= 0) { c.replaceChildren(el("p", { className: "fin-tanda", textContent: "🎉 ¡La tanda ha terminado!" })); return; }
    const s = Math.floor(ms / 1000);
    c.replaceChildren(
      caja(Math.floor(s / 86400), "días"), caja(Math.floor(s % 86400 / 3600), "horas"),
      caja(Math.floor(s % 3600 / 60), "min"), caja(s % 60, "seg"));
  };
  act();
  setInterval(act, 1000);
}

function nieve() {
  const cont = $("nieve");
  if (!cont || sinMovimiento) return;
  const n = innerWidth < 600 ? 14 : 30;
  for (let i = 0; i < n; i++) {
    cont.append(el("span", {
      className: "copo", textContent: "❄",
      style: `left:${Math.random() * 100}%;font-size:${8 + Math.random() * 14}px;` +
             `animation-duration:${8 + Math.random() * 10}s;animation-delay:${-Math.random() * 15}s`,
    }));
  }
}

// ---------- Eventos (solo admin.html) ----------
if (PAG_ADMIN) {
  $("formPersona").addEventListener("submit", (e) => {
    e.preventDefault();
    const nombre = $("nombre").value.trim();
    if (!nombre) return;
    estado.personas.push({ id: nuevoId(), nombre, dias: [] });
    $("nombre").value = "";
    render(); guardar();
  });

  $("btnLogout").addEventListener("click", () => backend.logout());

  $("formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("formLogin").querySelector("button");
    btn.disabled = true;
    try {
      await backend.login($("email").value.trim(), $("pass").value);
      $("pass").value = "";
      $("loginError").textContent = "";
    } catch (err) {
      $("loginError").textContent = err.status === 429 || err.status === 401
        ? err.message
        : "No se pudo conectar con el servidor.";
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Inicio ----------
intro();
nieve();
lucesNavidenas();
cuentaRegresiva();

(async () => {
  backend = await crearBackend({
    admin: PAG_ADMIN,
    alAvisar: mostrarAviso,
    alSesion: (v) => { esAdmin = PAG_ADMIN && v; render(); },
  });
  backend.suscribir((d) => {
    estado = { personas: (d.personas || []).map((p) => ({ id: p.id, nombre: String(p.nombre || ""), dias: Array.isArray(p.dias) ? p.dias : [] })) };
    render();
  });
})();
