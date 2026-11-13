"""
Servidor de la Tanda Navideña  (Flask + SQLite)

Qué hace:
  - Sirve las páginas públicas (index.html y admin.html).
  - Guarda los participantes (solo nombre) y sus pagos en tanda.db (SQLite).
  - Hay UN solo usuario (el administrador). No existe registro de usuarios.

API:
  GET  /api/datos    -> { personas: [{id, nombre, dias:[...]}] }   (público)
  GET  /api/sesion   -> { admin: true|false }
  POST /api/login    -> { email, pass }                            (inicia sesión)
  POST /api/logout
  PUT  /api/datos    -> { personas: [...] }                        (solo admin)

Uso:
  python crear_admin.py     (una sola vez: crea el usuario administrador)
  python server.py          (arranca en http://127.0.0.1:5000)
"""
import os
import re
import secrets
import sqlite3
import time
from datetime import date, timedelta
from hmac import compare_digest
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("TANDA_DB", BASE / "tanda.db"))
KEY_PATH = BASE / "secret.key"

# Debe coincidir con app.js
INICIO = date(2026, 11, 9)   # lunes 9 de noviembre
FIN = date(2026, 12, 18)     # viernes 18 de diciembre

MAX_PERSONAS = 100
MAX_NOMBRE = 40
ARCHIVOS_PUBLICOS = {"index.html", "admin.html", "style.css", "app.js", "backend.js"}

ID_RE = re.compile(r"^[A-Za-z0-9]{1,40}$")
FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")

# Anti fuerza bruta: 5 intentos fallidos -> bloqueo de 10 minutos por IP
MAX_FALLOS = 5
BLOQUEO_SEG = 600
_fallos: dict[str, list] = {}   # ip -> [numero_de_fallos, bloqueado_hasta]

# Hash falso para que el tiempo de respuesta sea igual si el correo no existe
_HASH_FALSO = generate_password_hash(secrets.token_hex(16))


# ---------------------------------------------------------------- Base de datos
def conectar() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db() -> None:
    with conectar() as con:
        con.executescript(
            """
            PRAGMA journal_mode = WAL;

            -- Un único administrador (la restricción id = 1 impide crear más)
            CREATE TABLE IF NOT EXISTS admin (
                id            INTEGER PRIMARY KEY CHECK (id = 1),
                email         TEXT NOT NULL,
                password_hash TEXT NOT NULL
            );

            -- Participantes: solo el nombre
            CREATE TABLE IF NOT EXISTS personas (
                orden  INTEGER PRIMARY KEY AUTOINCREMENT,
                id     TEXT NOT NULL UNIQUE,
                nombre TEXT NOT NULL
            );

            -- Cada fila = un día pagado ($10) por una persona
            CREATE TABLE IF NOT EXISTS pagos (
                persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                fecha      TEXT NOT NULL,
                PRIMARY KEY (persona_id, fecha)
            );
            """
        )


def leer_datos() -> dict:
    with conectar() as con:
        personas = [
            {"id": r["id"], "nombre": r["nombre"], "dias": []}
            for r in con.execute("SELECT id, nombre FROM personas ORDER BY orden")
        ]
        por_id = {p["id"]: p for p in personas}
        for r in con.execute("SELECT persona_id, fecha FROM pagos ORDER BY fecha"):
            por_id[r["persona_id"]]["dias"].append(r["fecha"])
    return {"personas": personas}


def validar_datos(cuerpo) -> list[dict]:
    """Valida y normaliza lo que manda el admin. Lanza ValueError con un mensaje claro."""
    if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get("personas"), list):
        raise ValueError("Formato de datos inválido.")
    lista = cuerpo["personas"]
    if len(lista) > MAX_PERSONAS:
        raise ValueError(f"Máximo {MAX_PERSONAS} participantes.")

    limpias, ids = [], set()
    for p in lista:
        if not isinstance(p, dict):
            raise ValueError("Participante inválido.")
        pid, nombre, dias = p.get("id"), p.get("nombre"), p.get("dias", [])
        if not isinstance(pid, str) or not ID_RE.match(pid) or pid in ids:
            raise ValueError("Identificador de participante inválido.")
        if not isinstance(nombre, str):
            raise ValueError("Nombre inválido.")
        nombre = CTRL_RE.sub("", nombre).strip()
        if not 1 <= len(nombre) <= MAX_NOMBRE:
            raise ValueError(f"El nombre debe tener entre 1 y {MAX_NOMBRE} caracteres.")
        if not isinstance(dias, list):
            raise ValueError("Lista de días inválida.")

        fechas = set()
        for f in dias:
            if not isinstance(f, str) or not FECHA_RE.match(f):
                raise ValueError("Fecha inválida.")
            try:
                d = date.fromisoformat(f)
            except ValueError:
                raise ValueError("Fecha inválida.") from None
            if not (INICIO <= d <= FIN) or d.weekday() > 4:
                raise ValueError(f"La fecha {f} no es un día hábil de la tanda.")
            fechas.add(f)

        ids.add(pid)
        limpias.append({"id": pid, "nombre": nombre, "dias": sorted(fechas)})
    return limpias


def guardar_datos(personas: list[dict]) -> None:
    con = conectar()
    try:
        con.execute("BEGIN IMMEDIATE")           # todo o nada
        con.execute("DELETE FROM pagos")
        con.execute("DELETE FROM personas")
        for p in personas:
            con.execute("INSERT INTO personas (id, nombre) VALUES (?, ?)", (p["id"], p["nombre"]))
            con.executemany(
                "INSERT INTO pagos (persona_id, fecha) VALUES (?, ?)",
                [(p["id"], f) for f in p["dias"]],
            )
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


# ------------------------------------------------------------------- Aplicación
def clave_secreta() -> bytes:
    if not KEY_PATH.exists():
        KEY_PATH.write_bytes(secrets.token_bytes(32))
    return KEY_PATH.read_bytes()


app = Flask(__name__, static_folder=None)
app.secret_key = clave_secreta()
app.config.update(
    MAX_CONTENT_LENGTH=256 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("TANDA_PROD") == "1",   # activar con HTTPS
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    JSON_AS_ASCII=False,
)
init_db()


@app.after_request
def cabeceras(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
    )
    resp.headers["Cache-Control"] = "no-store" if request.path.startswith("/api/") else "no-cache"
    return resp


def error(mensaje: str, codigo: int):
    return jsonify({"error": mensaje}), codigo


def requiere_json():
    if not request.is_json:
        abort(415)


@app.errorhandler(413)
def _demasiado_grande(_):
    return error("Datos demasiado grandes.", 413)


@app.errorhandler(415)
def _no_json(_):
    return error("Se esperaba JSON.", 415)


@app.errorhandler(400)
def _mala_peticion(_):
    return error("Petición inválida.", 400)


# ---- Páginas
@app.get("/")
def inicio():
    return send_from_directory(BASE, "index.html")


@app.get("/admin")
def admin_pagina():
    return send_from_directory(BASE, "admin.html")


@app.get("/<path:nombre>")
def estatico(nombre):
    if nombre not in ARCHIVOS_PUBLICOS:      # lista blanca: tanda.db, server.py, etc. NO se sirven
        abort(404)
    return send_from_directory(BASE, nombre)


# ---- API
@app.get("/api/datos")
def api_leer():
    return jsonify(leer_datos())


@app.get("/api/sesion")
def api_sesion():
    return jsonify({"admin": bool(session.get("admin"))})


@app.post("/api/login")
def api_login():
    requiere_json()
    ip = request.remote_addr or "?"
    ahora = time.time()
    estado = _fallos.get(ip, [0, 0])
    if estado[1] > ahora:
        minutos = int((estado[1] - ahora) // 60) + 1
        return error(f"Demasiados intentos. Espera {minutos} min e inténtalo de nuevo.", 429)

    cuerpo = request.get_json(silent=True) or {}
    email, clave = cuerpo.get("email"), cuerpo.get("pass")
    if not isinstance(email, str) or not isinstance(clave, str) or len(email) > 200 or len(clave) > 200:
        return error("Credenciales inválidas.", 400)

    with conectar() as con:
        fila = con.execute("SELECT email, password_hash FROM admin WHERE id = 1").fetchone()
    hash_ = fila["password_hash"] if fila else _HASH_FALSO
    correo_ok = bool(fila) and compare_digest(email.strip().lower().encode(), fila["email"].lower().encode())
    clave_ok = check_password_hash(hash_, clave)

    if correo_ok and clave_ok:
        _fallos.pop(ip, None)
        session.clear()
        session["admin"] = True
        session.permanent = True
        return jsonify({"admin": True})

    n = estado[0] + 1
    _fallos[ip] = [n, ahora + BLOQUEO_SEG] if n >= MAX_FALLOS else [n, 0]
    time.sleep(0.5)   # frena ataques automáticos
    return error("Correo o contraseña incorrectos.", 401)


@app.post("/api/logout")
def api_logout():
    session.clear()
    return jsonify({"admin": False})


@app.put("/api/datos")
def api_guardar():
    if not session.get("admin"):
        return error("Necesitas iniciar sesión.", 401)
    requiere_json()
    try:
        personas = validar_datos(request.get_json(silent=True))
    except ValueError as e:
        return error(str(e), 400)
    guardar_datos(personas)
    return jsonify({"ok": True})


if __name__ == "__main__":
    host = os.environ.get("TANDA_HOST", "127.0.0.1")
    puerto = int(os.environ.get("TANDA_PORT", "5000"))
    print(f"Tanda en http://{host}:{puerto}   (admin en /admin)")
    app.run(host=host, port=puerto, debug=False)
