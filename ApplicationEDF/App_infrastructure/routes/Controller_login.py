import os
import time

import bcrypt
from flask import Blueprint, redirect, render_template, request, session, url_for
from utilisation_ou_non_mqtt_mysql import USE_MYSQL

if USE_MYSQL:
    import mysql.connector
    from mysql.connector import Error

login_bp = Blueprint("login", __name__)

# ---------------------------------------------------------------------------
# Utilisateurs locaux pour travailler sans MySQL (chez soi)
# Modifier les mots de passe ici si besoin
# ---------------------------------------------------------------------------
_LOCAL_USERS = [
    {"id": 1, "username": "admin",     "password": "adminormandie765", "role": "admin"},
    {"id": 2, "username": "formateur", "password": "fnormandie765",    "role": "user"},
]

MAX_LOGIN_ATTEMPTS = 5
LOCK_DURATION_SECONDS = 5 * 60

# Configuration MySQL
MYSQL_CONFIG = {
    "host": "192.168.191.14",
    "user": "admin",
    "password": "superbddnormandie765",
    "database": "EDF",
    "port": 53306
}


def obtenir_secondes_verrou_restantes() -> int:
    lock_until = float(session.get("login_lock_until", 0) or 0)
    now = time.time()
    return max(0, int(lock_until - now))


def formater_temps_restant(seconds: int) -> str:
    minutes = seconds // 60
    remaining_seconds = seconds % 60
    if minutes <= 0:
        return f"{remaining_seconds} sec"
    return f"{minutes} min {remaining_seconds:02d} sec"


def message_erreur_verrou(remaining_seconds: int) -> str:
    return (
        "Trop de tentatives \u00e9chou\u00e9es. "
        f"R\u00e9essaie dans {formater_temps_restant(remaining_seconds)}."
    )


def message_identifiants_invalides(remaining_attempts: int) -> str:
    suffix = "tentative" if remaining_attempts == 1 else "tentatives"
    return (
        "Identifiant ou mot de passe incorrect, "
        f"il vous reste {remaining_attempts} {suffix}."
    )


def reinitialiser_tentatives_connexion() -> None:
    session.pop("login_attempts", None)
    session.pop("login_lock_until", None)


def normaliser_role(role: str) -> str:
    role_norm = str(role or "").strip().lower()
    if role_norm in {"admin", "administrateur"}:
        return "admin"
    return "user"


def enregistrer_tentative_echec() -> int:
    attempts = int(session.get("login_attempts", 0) or 0) + 1
    session["login_attempts"] = attempts

    if attempts >= MAX_LOGIN_ATTEMPTS:
        session["login_lock_until"] = time.time() + LOCK_DURATION_SECONDS

    return attempts


def authentifier_utilisateur(username: str, password: str) -> tuple:
    if not username or not password:
        return False, None

    # ------------------------------------------------------------------
    # Mode sans MySQL : authentification sur les utilisateurs locaux
    # ------------------------------------------------------------------
    if not USE_MYSQL:
        for user in _LOCAL_USERS:
            if user["username"] == username:
                stored = user["password"]
                if stored.startswith("$2b$") or stored.startswith("$2a$"):
                    if bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8")):
                        return True, dict(user)
                elif stored == password:
                    return True, dict(user)
        return False, None

    # ------------------------------------------------------------------
    # Mode MySQL
    # ------------------------------------------------------------------
    try:
        connection = mysql.connector.connect(**MYSQL_CONFIG)
        cursor = connection.cursor(dictionary=True)

        # Chercher l'utilisateur par username
        query = "SELECT * FROM users WHERE username = %s"
        cursor.execute(query, (username,))
        user = cursor.fetchone()

        cursor.close()
        connection.close()

        if user is None:
            return False, None

        # Verifier le mot de passe avec bcrypt
        stored_password = str(user.get("password", ""))
        if stored_password.startswith("$2b$") or stored_password.startswith("$2a$"):
            # Mot de passe hache avec bcrypt
            if bcrypt.checkpw(password.encode("utf-8"), stored_password.encode("utf-8")):
                return True, user
        else:
            # Fallback: mot de passe en clair (ancien format)
            if stored_password == password:
                return True, user

        return False, None

    except Exception as err:
        print(f"Erreur MySQL: {err}")
        return False, None


@login_bp.route("/login", methods=["GET", "POST"])
def connexion():
    remaining = obtenir_secondes_verrou_restantes()

    if remaining == 0 and session.get("login_lock_until"):
        reinitialiser_tentatives_connexion()

    if request.method == "POST":
        remaining = obtenir_secondes_verrou_restantes()
        if remaining > 0:
            session["login_error"] = message_erreur_verrou(remaining)
            session["login_locked"] = True
            return redirect(url_for("login.connexion"))

        username = request.form.get("login", "").strip()
        password = request.form.get("password", "")

        if not username or not password:
            return redirect(url_for("login.connexion"))

        auth_success, user_data = authentifier_utilisateur(username, password)
        
        if auth_success:
            session["is_authenticated"] = True
            session["user_id"] = user_data.get("id")
            session["username"] = user_data.get("username")
            session["role"] = normaliser_role(user_data.get("role", "user"))
            reinitialiser_tentatives_connexion()
            session.pop("login_error", None)
            session.pop("login_locked", None)
            return redirect(url_for("accueil.accueil_page", just_logged="1"))

        enregistrer_tentative_echec()
        remaining = obtenir_secondes_verrou_restantes()
        session.pop("is_authenticated", None)
        if remaining > 0:
            session["login_error"] = message_erreur_verrou(remaining)
            session["login_locked"] = True
        else:
            remaining_attempts = max(0, MAX_LOGIN_ATTEMPTS - int(session.get("login_attempts", 0) or 0))
            session["login_error"] = message_identifiants_invalides(remaining_attempts)
            session["login_locked"] = False

        return redirect(url_for("login.connexion"))

    # If user is already authenticated, avoid showing login again.
    if session.get("is_authenticated"):
        return redirect(url_for("accueil.accueil_page"))

    # Recover flash-style error from session (set during POST, consumed on GET)
    error = session.pop("login_error", None)
    locked = session.pop("login_locked", False)

    remaining = obtenir_secondes_verrou_restantes()
    if remaining > 0:
        error = message_erreur_verrou(remaining)
        locked = True

    return render_template("login/login.html", error=error, locked=locked)


@login_bp.route("/logout")
def deconnexion():
    session.pop("is_authenticated", None)
    session.pop("role", None)
    return redirect(url_for("login.connexion"))


def is_admin():
    """Verifier si l'utilisateur connecte a le role admin"""
    return session.get("role") == "admin"


def require_admin_role():
    """Decorateur pour proteger les routes admin"""
    from functools import wraps
    
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not session.get("is_authenticated") or not is_admin():
                return {"error": "Permission refus\u00e9e"}, 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator