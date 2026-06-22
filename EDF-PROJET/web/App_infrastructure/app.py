"""
Point d'entrée de l'application Flask.
Ce fichier configure l'application, les sessions et les blueprints.
"""

import os

from flask import Flask, redirect, request, session, url_for

from Controlleurs.Controlleur import accueil_bp, c2_bp, cm_bp, cpo_bp, login_bp, reglages_bp


# Point d'entrée de l'application Flask.
# Ce module crée l'application, active les protections de session,
# applique un contrôle de connexion global et enregistre les blueprints.

def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    # Clé secrète de session : changer en production via variable d'environnement.
    app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.config["TEMPLATES_AUTO_RELOAD"] = debug
    app.jinja_env.auto_reload = debug

    # Sécurité des cookies de session.
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    # Activer SESSION_COOKIE_SECURE = True dès que l'application tourne en HTTPS.

    @app.after_request
    def add_security_headers(response):
        # Headers de protection contre clickjacking, sniffing et fuite d'origine.
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    @app.before_request
    def require_login():
        endpoint = request.endpoint or ""

        # Autorise l'accès aux ressources statiques et à la page de login.
        if endpoint == "static" or endpoint.startswith("login."):
            return None

        # Vérifie l'authentification pour toutes les autres routes.
        if not session.get("is_authenticated"):
            return redirect(url_for("login.connexion"))

        return None

    # Enregistre tous les blueprints de l'application.
    app.register_blueprint(login_bp)
    app.register_blueprint(accueil_bp)
    app.register_blueprint(c2_bp)
    app.register_blueprint(cm_bp)
    app.register_blueprint(cpo_bp)
    app.register_blueprint(reglages_bp)

    return app


if __name__ == "__main__":
    host = "0.0.0.0"
    # Port interne par défaut de l'application Flask.
    port = int(os.environ.get("FLASK_PORT", "5001"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    # Lancer le serveur de développement Flask.
    create_app().run(host=host, port=port, debug=debug, use_reloader=False)
