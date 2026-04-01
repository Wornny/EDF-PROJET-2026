import os

from flask import Flask, redirect, request, session, url_for

from Controlleurs.Controlleur import accueil_bp, c2_bp, cm_bp, cpo_bp, login_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.config["TEMPLATES_AUTO_RELOAD"] = debug
    app.jinja_env.auto_reload = debug

    @app.before_request
    def require_login():
        endpoint = request.endpoint or ""
        if endpoint == "static" or endpoint.startswith("login."):
            return None

        if not session.get("is_authenticated"):
            return redirect(url_for("login.connexion"))

        return None

    app.register_blueprint(login_bp)
    app.register_blueprint(accueil_bp)
    app.register_blueprint(c2_bp)
    app.register_blueprint(cm_bp)
    app.register_blueprint(cpo_bp)

    return app


if __name__ == "__main__":
    host = "0.0.0.0"
    # Keep default port aligned with NAT rule (external 55001 -> internal 5001).
    port = int(os.environ.get("FLASK_PORT", "5001"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    create_app().run(host=host, port=port, debug=debug, use_reloader=False)
