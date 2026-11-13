"use strict";
/*
 * CAPA DE DATOS  (único archivo del front que habla con el servidor Python)
 * -------------------------------------------------------------------------
 *   const b = await crearBackend({ admin, alAvisar, alSesion });
 *
 *   ctx.admin      true en admin.html, false en index.html
 *   ctx.alAvisar   (texto) => muestra/oculta un aviso ("" lo oculta)
 *   ctx.alSesion   (bool)  => se llama cuando cambia la sesión del administrador
 *
 *   b.suscribir(cb)       cb({ personas }) al cargar y cuando cambian los datos
 *   b.guardar(datos)      Promise; datos = { personas }   (solo admin)
 *   b.login(email, pass)  Promise; lanza error si son incorrectos
 *   b.logout()            Promise
 *
 * Endpoints (server.py): GET/PUT /api/datos, GET /api/sesion, POST /api/login, POST /api/logout
 */
(function () {
  const REFRESCO_MS = 20000; // la página pública se actualiza sola cada 20 s

  async function api(ruta, opciones = {}) {
    const r = await fetch(ruta, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opciones,
    });
    let cuerpo = null;
    try { cuerpo = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok) {
      const e = new Error((cuerpo && cuerpo.error) || "Error " + r.status);
      e.status = r.status;
      throw e;
    }
    return cuerpo;
  }

  window.crearBackend = async function (ctx) {
    let ultimo = "";            // última versión mostrada (evita repintar sin cambios)
    let escucha = null;         // callback de suscribir
    let cola = Promise.resolve(); // los guardados salen en orden, uno tras otro

    const emitir = (datos) => {
      const s = JSON.stringify(datos);
      if (s === ultimo || !escucha) return;
      ultimo = s;
      escucha(datos);
    };

    async function cargar() {
      try {
        emitir(await api("/api/datos"));
        ctx.alAvisar("");
      } catch {
        ctx.alAvisar("No se pudo conectar con el servidor. Reintentando…");
      }
    }

    return {
      modo: "servidor",

      async suscribir(cb) {
        escucha = cb;
        if (ctx.admin) {
          try { ctx.alSesion(!!(await api("/api/sesion")).admin); }
          catch { ctx.alSesion(false); }
        }
        await cargar();
        // Solo la vista pública se refresca sola; el admin es el único que escribe.
        if (!ctx.admin) setInterval(() => { if (!document.hidden) cargar(); }, REFRESCO_MS);
      },

      guardar(datos) {
        const envio = cola.catch(() => {}).then(async () => {
          try {
            await api("/api/datos", { method: "PUT", body: JSON.stringify({ personas: datos.personas }) });
          } catch (e) {
            if (e.status === 401) ctx.alSesion(false); // la sesión expiró
            throw e;
          }
        });
        cola = envio;
        return envio;
      },

      async login(email, pass) {
        await api("/api/login", { method: "POST", body: JSON.stringify({ email, pass }) });
        ctx.alSesion(true);
        ultimo = "";      // vuelve a traer lo guardado en el servidor
        await cargar();
      },

      async logout() {
        try { await api("/api/logout", { method: "POST", body: "{}" }); } catch { /* ignorar */ }
        ctx.alSesion(false);
      },
    };
  };
})();
