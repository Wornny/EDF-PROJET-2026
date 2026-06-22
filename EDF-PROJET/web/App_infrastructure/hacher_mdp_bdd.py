"""
Script de migration : hache tous les mots de passe en clair dans la table users.
A executer UNE SEULE FOIS sur le serveur, puis on peut le supprimer du serveur si on veut des qu'il a été éxécuté.

Usage :
    pip install bcrypt mysql-connector-python
    python hacher_mdp_bdd.py
"""

import bcrypt
import os
import mysql.connector

# Configuration de connexion MySQL, lisible via variables d'environnement.
MYSQL_CONFIG = {
    "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
    "user": os.environ.get("MYSQL_USER", "root"),
    "password": os.environ.get("MYSQL_PASSWORD", ""),
    "database": os.environ.get("MYSQL_DATABASE", "EDF"),
    "port": int(os.environ.get("MYSQL_PORT", "3306")),
}


def main():
    # Ouvre la connexion puis lit tous les utilisateurs.
    connection = mysql.connector.connect(**MYSQL_CONFIG)
    cursor = connection.cursor(dictionary=True)

    cursor.execute("SELECT id, username, password FROM users")
    users = cursor.fetchall()

    updated = 0
    for user in users:
        pwd = str(user["password"] or "")

        # Ne pas re-hacher un mot de passe déjà encodé en bcrypt.
        if pwd.startswith("$2b$") or pwd.startswith("$2a$"):
            print(f"  [SKIP] {user['username']} - deja hache")
            continue

        hashed = bcrypt.hashpw(pwd.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        cursor.execute(
            "UPDATE users SET password = %s WHERE id = %s",
            (hashed, user["id"]),
        )
        updated += 1
        print(f"  [OK]   {user['username']} - mot de passe hache")

    connection.commit()
    cursor.close()
    connection.close()

    print(f"\nTermine : {updated} mot(s) de passe mis a jour sur {len(users)} utilisateur(s).")


if __name__ == "__main__":
    main()
