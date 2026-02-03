from flask import Flask, request, render_template, redirect
import logging
import json
import os

USE_MQTT = True    # False chez moi sans MQTT et True au lycée
if USE_MQTT:
    import paho.mqtt.client as mqtt

# ===================== PERSISTANCE =====================
VALUES_FILE = "cm_values.json"

def load_values():
    """Charge les valeurs depuis le fichier JSON ou retourne les valeurs par défaut"""
    if os.path.exists(VALUES_FILE):
        try:
            with open(VALUES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Convertir les clés string en int
                return {int(k): v for k, v in data.items()}
        except Exception as e:
            print(f"Erreur lors du chargement des valeurs: {e}")
    
    # Valeurs par défaut
    default_values = {}
    for i in range(1, 12):
        default_values[i] = {
            "NivContamination": "1",
            "BruitDeFond": "0.50",
        }
    return default_values

def save_values(values_dict):
    """Sauvegarde les valeurs dans le fichier JSON"""
    try:
        with open(VALUES_FILE, 'w', encoding='utf-8') as f:
            json.dump(values_dict, f, indent=2)
    except Exception as e:
        print(f"Erreur lors de la sauvegarde des valeurs: {e}")

# ===================== MQTT =====================
BROKER_HOST = "192.168.190.31"
BROKER_PORT = 1883

def get_topic_contamination(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id:02d}/NivContamination"

def get_topic_bdf(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id:02d}/BruitDeFond"

# ===================== FLASK =====================
app = Flask(__name__)
logging.getLogger("werkzeug").setLevel(logging.ERROR)

# Charger les valeurs sauvegardées ou valeurs par défaut
last_values = load_values()

mqtt_client = None

def _clean_payload(payload: str) -> str:
    p = (payload or "").strip()
    return p.replace("Bq/cm²", "").strip()

def on_message(client, userdata, msg):
    try:
        payload = _clean_payload(msg.payload.decode("utf-8", errors="ignore"))
        
        # Extraire CM_ID du topic (format: FormaReaEDF/ControllerMobile/CM_XX/...)
        parts = msg.topic.split("/")
        if len(parts) < 4 or not parts[2].startswith("CM_"):
            return
            
        try:
            cm_id = int(parts[2][3:])  # Extraire XX de CM_XX
        except ValueError:
            return
        
        if cm_id < 1 or cm_id > 11:
            return

        if "NivContamination" in msg.topic:
            last_values[cm_id]["NivContamination"] = payload
        elif "BruitDeFond" in msg.topic:
            last_values[cm_id]["BruitDeFond"] = payload

    except Exception as e:
        print("MQTT on_message error:", e)

if USE_MQTT:
    mqtt_client = mqtt.Client(client_id="IHM_ControllerMobile")
    mqtt_client.on_message = on_message
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    # S'abonner à tous les topics ControllerMobile/CM_XX
    for cm_id in range(1, 12):
        mqtt_client.subscribe(get_topic_contamination(cm_id))
        mqtt_client.subscribe(get_topic_bdf(cm_id))

    # Publier les valeurs initiales pour tous les CM
    for cm_id in range(1, 12):
        mqtt_client.publish(get_topic_contamination(cm_id), f"{last_values[cm_id]['NivContamination']} Bq/cm²", retain=True)
        mqtt_client.publish(get_topic_bdf(cm_id), f"{last_values[cm_id]['BruitDeFond']} Bq/cm²", retain=True)

    mqtt_client.loop_start()

# ===================== ROUTES (✅ ControllerMobile) =====================
@app.route("/")
def root():
    return redirect("/ControllerMobile/1")

@app.route("/ControllerMobile")
def controllermobile_root():
    return redirect("/ControllerMobile/1")

@app.route("/ControllerMobile/<int:cm_id>")
def page_cm(cm_id: int):
    if cm_id < 1 or cm_id > 11:
        cm_id = 1

    return render_template(
        "InterfaceGraphique_CM.html",
        cm_id=cm_id,
        valeur_conta=last_values[cm_id]["NivContamination"],
        valeur_bdf=last_values[cm_id]["BruitDeFond"],
    )

@app.route("/slider/<int:cm_id>", methods=["POST"])
def slider(cm_id: int):
    if cm_id < 1 or cm_id > 11:
        return "unknown cm_id", 400

    value = request.form.get("value")
    type_ = request.form.get("type")   # contamination | bruitdefond
    equip = request.form.get("equip")

    if value is None:
        return "missing value", 400

    if type_ == "bruitdefond":
        last_values[cm_id]["BruitDeFond"] = value
        topic = get_topic_bdf(cm_id)
    else:
        last_values[cm_id]["NivContamination"] = value
        topic = get_topic_contamination(cm_id)

    # Sauvegarder les valeurs dans le fichier JSON
    save_values(last_values)

    print(equip, type_, "=", value, "Bq/cm²")

    if USE_MQTT and mqtt_client:
        mqtt_client.publish(topic, f"{value} Bq/cm²", retain=True)

    return "ok"

# ===================== LANCEMENT =====================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
