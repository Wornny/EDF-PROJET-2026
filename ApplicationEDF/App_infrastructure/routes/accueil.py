from pathlib import Path

from flask import Blueprint, redirect, render_template, send_from_directory, session, url_for

accueil_bp = Blueprint("accueil", __name__)

INITIALISATEUR_DIR = Path(__file__).resolve().parents[2] / "App_initialisateur"


@accueil_bp.route("/")
def accueil():
    return redirect(url_for("accueil.accueil_page"))


@accueil_bp.route("/accueil")
def accueil_page():
    if not session.get("is_authenticated"):
        return redirect(url_for("login.connexion"))

    return render_template("accueil/accueil.html")


@accueil_bp.route("/menu")
def menu():
    # Legacy alias to keep old links working.
    return redirect(url_for("accueil.accueil_page"))


@accueil_bp.route("/initialisateur")
def initialisateur_root():
    return redirect(url_for("accueil.initialisateur_index"))


@accueil_bp.route("/initialisateur/")
@accueil_bp.route("/initialisateur/index.html")
def initialisateur_index():
    return send_from_directory(INITIALISATEUR_DIR, "index.html")


@accueil_bp.route("/initialisateur/<path:filename>")
def initialisateur_files(filename: str):
    return send_from_directory(INITIALISATEUR_DIR, filename)
