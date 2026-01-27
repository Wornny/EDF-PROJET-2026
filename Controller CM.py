from flask import Flask, request
import logging

# Désactiver les logs HTTP de Werkzeug
log = logging.getLogger("werkzeug")
log.disabled = True

app = Flask(__name__)

@app.route("/slider", methods=["POST"])
def slider():
    value = request.form.get("value")
    print("Valeur du slider :", value)
    return "ok"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
