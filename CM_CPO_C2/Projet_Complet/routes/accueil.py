from flask import Blueprint, redirect, render_template, session, url_for

accueil_bp = Blueprint("accueil", __name__)


@accueil_bp.route("/")
def accueil():
    return redirect(url_for("accueil.menu"))


@accueil_bp.route("/menu")
def menu():
    if not session.get("is_authenticated"):
        return redirect(url_for("login.connexion"))

    return render_template("accueil/menu.html")
