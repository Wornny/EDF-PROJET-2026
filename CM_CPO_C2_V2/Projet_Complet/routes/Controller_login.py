from flask import Blueprint, redirect, render_template, request, session, url_for

login_bp = Blueprint("login", __name__)

VALID_USERNAME = "Admin"
VALID_PASSWORD = "admin"


@login_bp.route("/", methods=["GET", "POST"])
@login_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("login", "").strip()
        password = request.form.get("password", "")

        if username == VALID_USERNAME and password == VALID_PASSWORD:
            session["is_authenticated"] = True
            return redirect(url_for("accueil.menu"))

        session.pop("is_authenticated", None)
        return render_template("login/login.html", error="Identifiant ou mot de passe incorrect")

    session.pop("is_authenticated", None)
    return render_template("login/login.html")