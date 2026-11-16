# Tanda Navideña

Página para llevar una tanda de amigos ($10 diarios, lunes a viernes, del 9 de nov al 18 de dic de 2026).

- `/` es la vista pública, solo lectura.
- `/admin` es el panel del administrador (un único usuario, con inicio de sesión).
- Python (Flask) con SQLite. No hay registro de usuarios.

## Despliegue con Docker (recomendado)

Los datos (`tanda.db`) y la clave de sesiones (`secret.key`) viven en un **volumen de Docker** llamado
`tanda_data`. Así sobreviven a rebuilds, redeploys y reinicios.

```bash
git clone https://github.com/Apaez200/Posada_y_pisteada.git
cd Posada_y_pisteada
cp .env.example .env        # editar: correo y contraseña del administrador
docker compose up -d --build
```

La página queda en `http://localhost:5000`. Para actualizar tras un cambio de código:

```bash
git pull
docker compose up -d --build     # el volumen se conserva
```

> ⚠️ **Nunca** uses `docker compose down -v` ni `docker volume rm tanda_data`: borran todos los pagos.
> `docker compose down` a secas es seguro.

### Variables (`.env`)

| Variable | Qué hace |
|---|---|
| `TANDA_ADMIN_EMAIL` / `TANDA_ADMIN_PASS` | Credenciales del único administrador. Cambiarlas y reiniciar las actualiza. |
| `TANDA_PROD` | `1` cuando el sitio se sirve con HTTPS (cookie de sesión segura). |
| `TANDA_PROXY` | `1` si hay un proxy inverso (Nginx, Caddy, Traefik) delante. Necesario para que el bloqueo de intentos de login vea la IP real. |
| `TANDA_PORT` | Puerto publicado (por defecto 5000). |

El contenedor no trae HTTPS: ponle delante un proxy inverso con certificado (Caddy, Nginx, Traefik)
y usa `TANDA_PROD=1` y `TANDA_PROXY=1`.

### Respaldo y restauración

```bash
# Respaldo (copia consistente de la base de datos)
docker compose exec tanda python -c "import sqlite3; s=sqlite3.connect('/data/tanda.db'); d=sqlite3.connect('/data/respaldo.db'); s.backup(d)"
docker compose cp tanda:/data/respaldo.db ./respaldo-tanda.db

# Restaurar: detener, copiar el archivo al volumen y arrancar
docker compose stop tanda
docker run --rm -v posada_y_pisteada_tanda_data:/data -v "$PWD":/src alpine cp /src/respaldo-tanda.db /data/tanda.db
docker compose start tanda
```

(El nombre del volumen lleva como prefijo el nombre de la carpeta del proyecto; compruébalo con `docker volume ls`.)

## Sin Docker (desarrollo)

```bash
pip install -r requirements.txt
python crear_admin.py correo@ejemplo.com      # pide la contraseña
python server.py                              # http://127.0.0.1:5000
```

## Archivos que nunca se suben a git

`.env`, `tanda.db`, `secret.key`, `CREDENCIALES.md` (ya están en `.gitignore`).
