import os
import sqlite3

from flask import Blueprint, redirect, render_template, request, session, url_for

login_bp = Blueprint("login", __name__)


def _authenticate_user(username: str, password: str) -> bool:
    if not username or not password:
        return False

    db_path = os.environ.get(
        "AUTH_DB_PATH",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "users.db"),
    )

    if not os.path.exists(db_path):
        return False

    try:
        with sqlite3.connect(db_path) as connection:
            connection.row_factory = sqlite3.Row
            cursor = connection.cursor()
            cursor.execute("PRAGMA table_info(users)")
            columns = {row["name"] for row in cursor.fetchall()}

            login_columns = [
                column
                for column in ("login", "username", "identifiant", "user", "utilisateur")
                if column in columns
            ]
            password_columns = [
                column
                for column in ("password", "mot_de_passe", "mdp", "pass")
                if column in columns
            ]

            if not login_columns or not password_columns:
                return False

            selected_columns = ", ".join(f'"{column}"' for column in (login_columns + password_columns))
            where_clause = " OR ".join(f'LOWER("{column}") = LOWER(?)' for column in login_columns)
            query = f"SELECT {selected_columns} FROM users WHERE {where_clause} LIMIT 1"
            cursor.execute(query, tuple(username for _ in login_columns))

            row = cursor.fetchone()
            if row is None:
                return False

            for column in password_columns:
                if str(row[column]) == password:
                    return True

            return False
    except sqlite3.Error:
        return False


@login_bp.route("/", methods=["GET", "POST"])
@login_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("login", "").strip()
        password = request.form.get("password", "")

        if _authenticate_user(username, password):
            session["is_authenticated"] = True
            return redirect(url_for("accueil.menu"))

        session.pop("is_authenticated", None)
        return render_template("login/login.html", error="Identifiant ou mot de passe incorrect")

    session.pop("is_authenticated", None)
    return render_template("login/login.html")