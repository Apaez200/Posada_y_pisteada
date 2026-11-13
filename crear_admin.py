"""
Crea (o reemplaza) al ÚNICO usuario administrador.
La contraseña se guarda cifrada (hash); nunca en texto plano en la base de datos.

Uso:
    python crear_admin.py correo@ejemplo.com            (pide la contraseña sin mostrarla)
    python crear_admin.py correo@ejemplo.com contraseña
"""
import getpass
import sys

from werkzeug.security import generate_password_hash

import server


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    email = sys.argv[1].strip().lower()
    clave = sys.argv[2] if len(sys.argv) > 2 else getpass.getpass("Contraseña: ")
    if "@" not in email or not clave:
        sys.exit("Correo o contraseña inválidos.")

    with server.conectar() as con:
        con.execute(
            "INSERT INTO admin (id, email, password_hash) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash",
            (email, generate_password_hash(clave)),
        )
    print(f"Administrador listo: {email}")


if __name__ == "__main__":
    main()
