from flask import Flask

from routes.Controller_CM import cm_bp
from routes.Controller_CPO import cpo_bp
from routes.accueil import accueil_bp


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    app.register_blueprint(accueil_bp)
    app.register_blueprint(cm_bp)
    app.register_blueprint(cpo_bp)

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5000, debug=True)
