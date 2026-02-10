from flask import Blueprint, redirect, render_template, url_for

accueil_bp = Blueprint("accueil", __name__)


@accueil_bp.route("/")
def accueil():
    return render_template("accueil/menu.html")


@accueil_bp.route("/menu")
def menu():
    return redirect(url_for("accueil.accueil"))
