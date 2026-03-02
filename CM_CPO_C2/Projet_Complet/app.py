import os

from flask import Flask, redirect, request, session, url_for

from routes.Controller_C2 import c2_bp
from routes.Controller_CM import cm_bp
from routes.Controller_CPO import cpo_bp
from routes.Controller_login import login_bp
from routes.accueil import accueil_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

    @app.before_request
    def require_login():
        endpoint = request.endpoint or ""
        if endpoint == "static" or endpoint.startswith("login."):
            return None

        if not session.get("is_authenticated"):
            return redirect(url_for("login.login"))

        return None

    app.register_blueprint(login_bp)
    app.register_blueprint(accueil_bp)
    app.register_blueprint(c2_bp)
    app.register_blueprint(cm_bp)
    app.register_blueprint(cpo_bp)

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5000, debug=True)
