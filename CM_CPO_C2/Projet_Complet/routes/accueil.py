from flask import Blueprint, redirect, render_template, session, url_for

accueil_bp = Blueprint("accueil", __name__)


@accueil_bp.route("/menu")
def menu():
    if not session.get("is_authenticated"):
        return redirect(url_for("login.login"))

    return render_template("accueil/menu.html")
