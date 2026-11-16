FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TANDA_DATA=/data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn==22.0.0

# Solo lo necesario (ver .dockerignore): nada de bases de datos ni credenciales en la imagen
COPY server.py crear_admin.py index.html admin.html style.css app.js backend.js ./

# Usuario sin privilegios y carpeta de datos (aquí vive el VOLUMEN con tanda.db y secret.key)
RUN useradd --create-home --uid 1000 tanda \
    && mkdir /data \
    && chown tanda:tanda /data
USER tanda
VOLUME ["/data"]

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:5000/api/sesion', timeout=3)" || exit 1

# 1 worker + hilos: el bloqueo de intentos de login se guarda en memoria del proceso
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--access-logfile", "-", "server:app"]
