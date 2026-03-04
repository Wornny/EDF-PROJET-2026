import os
import sqlite3
import time

from flask import Blueprint, redirect, render_template, request, session, url_for

login_bp = Blueprint("login", __name__)

MAX_LOGIN_ATTEMPTS = 5
LOCK_DURATION_SECONDS = 15 * 60


def _get_lock_remaining_seconds() -> int:
    lock_until = float(session.get("login_lock_until", 0) or 0)
    now = time.time()
    return max(0, int(lock_until - now))


def _format_remaining_time(seconds: int) -> str:
    minutes = seconds // 60
    remaining_seconds = seconds % 60
    if minutes <= 0:
        return f"{remaining_seconds} sec"
    return f"{minutes} min {remaining_seconds:02d} sec"


def _lock_error_message(remaining_seconds: int) -> str:
    return (
        "Trop de tentatives échouées. "
        f"Réessaie dans {_format_remaining_time(remaining_seconds)}."
    )


def _invalid_credentials_message(remaining_attempts: int) -> str:
    suffix = "tentative" if remaining_attempts == 1 else "tentatives"
    return (
        "Identifiant ou mot de passe incorrect, "
        f"il vous reste {remaining_attempts} {suffix}."
    )


def _reset_login_attempts() -> None:
    session.pop("login_attempts", None)
    session.pop("login_lock_until", None)


def _register_failed_attempt() -> int:
    attempts = int(session.get("login_attempts", 0) or 0) + 1
    session["login_attempts"] = attempts

    if attempts >= MAX_LOGIN_ATTEMPTS:
        session["login_lock_until"] = time.time() + LOCK_DURATION_SECONDS

    return attempts


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
    remaining = _get_lock_remaining_seconds()

    if remaining == 0 and session.get("login_lock_until"):
        _reset_login_attempts()

    if request.method == "POST":
        remaining = _get_lock_remaining_seconds()
        if remaining > 0:
            return render_template(
                "login/login.html",
                error=_lock_error_message(remaining),
                locked=True,
            )

        username = request.form.get("login", "").strip()
        password = request.form.get("password", "")

        if _authenticate_user(username, password):
            session["is_authenticated"] = True
            _reset_login_attempts()
            return redirect(url_for("accueil.menu"))

        _register_failed_attempt()
        remaining = _get_lock_remaining_seconds()
        session.pop("is_authenticated", None)
        if remaining > 0:
            return render_template(
                "login/login.html",
                error=_lock_error_message(remaining),
                locked=True,
            )

        remaining_attempts = max(0, MAX_LOGIN_ATTEMPTS - int(session.get("login_attempts", 0) or 0))
        return render_template(
            "login/login.html",
            error=_invalid_credentials_message(remaining_attempts),
            locked=False,
        )

    session.pop("is_authenticated", None)
    remaining = _get_lock_remaining_seconds()
    if remaining > 0:
        return render_template(
            "login/login.html",
            error=_lock_error_message(remaining),
            locked=True,
        )

    return render_template("login/login.html", locked=False)