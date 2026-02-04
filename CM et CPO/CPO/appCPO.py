from flask import Flask, request, render_template, redirect
import logging

USE_MQTT = True    # False chez moi sans MQTT et True au lycée
CLEAN_OLD_TOPICS = True  # Nettoie l'ancien arbre ControllerPoste (retained)
if USE_MQTT:
    import paho.mqtt.client as mqtt

def default_values():
    values = {}
    for i in range(1, 12):
        values[i] = {
            "NivContamination": "1",
            "BruitDeFond": "0.50",
        }
    return values

# ===================== MQTT =====================
BROKER_HOST = "192.168.190.31"
BROKER_PORT = 1883

def get_topic_contamination(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id:02d}/NivContamination"

def get_topic_bdf(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id:02d}/BruitDeFond"

# ===================== FLASK =====================
app = Flask(__name__, template_folder="templates", static_folder="static")
logging.getLogger("werkzeug").setLevel(logging.ERROR)

last_values = default_values()

mqtt_client = None

def _clean_payload(payload: str) -> str:
    p = (payload or "").strip()
    return p.replace("Bq/cm²", "").strip()

def on_message(client, userdata, msg):
    try:
        payload = _clean_payload(msg.payload.decode("utf-8", errors="ignore"))

        if "/CPO_" not in msg.topic:
            return

        try:
            cpo_part = msg.topic.split("/")[2]  # CPO_01
            cpo_id = int(cpo_part.replace("CPO_", ""))
        except Exception:
            return

        if cpo_id not in (1, 2):
            return

        if "NivContamination" in msg.topic:
            last_values[cpo_id]["NivContamination"] = payload
        elif "BruitDeFond" in msg.topic:
            last_values[cpo_id]["BruitDeFond"] = payload

    except Exception as e:
        print("MQTT on_message error:", e)

if USE_MQTT:
    mqtt_client = mqtt.Client(client_id="IHM_CPO")
    mqtt_client.on_message = on_message
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    if CLEAN_OLD_TOPICS:
        mqtt_client.publish("FormaReaEDF/CPO/NivContamination", "", retain=True)
        mqtt_client.publish("FormaReaEDF/CPO/BruitDeFond", "", retain=True)
        mqtt_client.publish("FormaReaEDF/CPO/CPO_ID1/NivContamination", "", retain=True)
        mqtt_client.publish("FormaReaEDF/CPO/CPO_ID1/BruitDeFond", "", retain=True)
        mqtt_client.publish("FormaReaEDF/CPO/CPO_ID2/NivContamination", "", retain=True)
        mqtt_client.publish("FormaReaEDF/CPO/CPO_ID2/BruitDeFond", "", retain=True)
        for cpo_id in range(1, 12):
            old_conta = f"FormaReaEDF/ControllerPoste/CPO_{cpo_id:02d}/NivContamination"
            old_bdf = f"FormaReaEDF/ControllerPoste/CPO_{cpo_id:02d}/BruitDeFond"
            mqtt_client.publish(old_conta, "", retain=True)
            mqtt_client.publish(old_bdf, "", retain=True)

    for cpo_id in (2, 1):
        mqtt_client.subscribe(get_topic_contamination(cpo_id))
        mqtt_client.subscribe(get_topic_bdf(cpo_id))
        mqtt_client.publish(get_topic_contamination(cpo_id), f"{last_values[cpo_id]['NivContamination']} Bq/cm²", retain=True)
        mqtt_client.publish(get_topic_bdf(cpo_id), f"{last_values[cpo_id]['BruitDeFond']} Bq/cm²", retain=True)

    mqtt_client.loop_start()

# ===================== ROUTES =====================
@app.route("/")
def root():
    return redirect("/CPO/1")

@app.route("/CPO")
def cpo_root():
    return redirect("/CPO/1")

@app.route("/CPO/<int:cpo_id>")
def page_cpo(cpo_id: int):
    if cpo_id not in (1, 2):
        cpo_id = 1

    return render_template(
        "CPO.html",
        cpo_id=cpo_id,
        valeur_conta=last_values[cpo_id]["NivContamination"],
        valeur_bdf=last_values[cpo_id]["BruitDeFond"],
    )

@app.route("/slider/<int:cpo_id>", methods=["POST"])
def slider(cpo_id: int):
    if cpo_id not in (1, 2):
        return "unknown cpo_id", 400

    value = request.form.get("value")
    type_ = request.form.get("type")
    equip = request.form.get("equip")

    if value is None:
        return "missing value", 400

    type_norm = (type_ or "").strip().lower()

    if "bruit" in type_norm:
        last_values[cpo_id]["BruitDeFond"] = value
        topic = get_topic_bdf(cpo_id)
        display_type = "Bruit de fond"
    else:
        last_values[cpo_id]["NivContamination"] = value
        topic = get_topic_contamination(cpo_id)
        display_type = "Contamination"

    print(equip, display_type, "=", value, "Bq/cm²")

    if USE_MQTT and mqtt_client:
        mqtt_client.publish(topic, f"{value} Bq/cm²", retain=True)

    return "ok"

# ===================== LANCEMENT =====================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
