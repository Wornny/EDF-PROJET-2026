<<<<<<< HEAD
from flask import Blueprint, redirect, render_template, url_for

accueil_bp = Blueprint("accueil", __name__)


@accueil_bp.route("/")
def accueil():
    return render_template("accueil/menu.html")


@accueil_bp.route("/menu")
def menu():
    return redirect(url_for("accueil.accueil"))
=======
from flask import Blueprint, redirect, render_template, session, url_for

accueil_bp = Blueprint("accueil", __name__)


@accueil_bp.route("/menu")
def menu():
    if not session.get("is_authenticated"):
        return redirect(url_for("login.login"))

    return render_template("accueil/menu.html")
>>>>>>> 3ddada121b7176518b626efcc8466ba588802fd3
