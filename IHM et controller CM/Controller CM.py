from flask import Flask, request, render_template, redirect
import logging

# ===================== MODE =====================
USE_MQTT = False  # False chez moi et True au lycée


if USE_MQTT:
    import paho.mqtt.client as mqtt
    BROKER_HOST = "192.168.190.31"
    BROKER_PORT = 1883
    TOPIC_TEMPLATE = "FormaReaEDF/CapteurMobile/CM_{cm_id}/NivContamination"

# ===================== FLASK =====================
app = Flask(__name__)

# ✅ supprime le spam : 127.0.0.1 - - "POST /..."
logging.getLogger("werkzeug").setLevel(logging.ERROR)

mqtt_client = None
if USE_MQTT:
    mqtt_client = mqtt.Client(client_id="IHM_CM")
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    mqtt_client.loop_start()

# Dernière valeur par CM (CM 1..11)
last_values = {i: "0.00" for i in range(1, 12)}


@app.route("/")
def root():
    return redirect("/CapteurMobile/1")


@app.route("/CapteurMobile")
def capteurmobile():
    return redirect("/CapteurMobile/1")


@app.route("/CapteurMobile/<int:cm_id>")
def page_cm(cm_id: int):
    if cm_id not in last_values:
        cm_id = 1

    return render_template(
        "InterfaceGraphique_CM.html",
        cm_id=cm_id,
        valeur_init=last_values[cm_id]
    )


@app.route("/slider/<int:cm_id>", methods=["POST"])
def slider(cm_id: int):
    if cm_id not in last_values:
        return "unknown cm_id", 400

    value = request.form.get("value")
    type_ = request.form.get("type")
    equip = request.form.get("equip")

    if value is not None:
        last_values[cm_id] = value

    print(equip, "Niveau de", type_, "=", value, "Bq/cm²")

    # ✅ Publish MQTT seulement si USE_MQTT=True
    if USE_MQTT and mqtt_client:
        topic = TOPIC_TEMPLATE.format(cm_id=cm_id)
        mqtt_client.publish(topic, str(value), retain=True)

    return "ok"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
