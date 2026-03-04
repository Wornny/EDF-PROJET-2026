import logging

from flask import Blueprint, jsonify, redirect, render_template, request, url_for

USE_MQTT = True  # False chez moi sans MQTT et True au lycee
if USE_MQTT:
    import paho.mqtt.client as mqtt

cm_bp = Blueprint("cm", __name__, url_prefix="/ControllerMobile")


def default_values():
    values = {}
    for i in range(1, 12):
        values[i] = default_entry()
    return values


def default_entry():
    return {
        "NivContamination": "1",
        "BruitDeFond": "0.50",
    }


def default_names():
    return {i: f"CM ID {i}" for i in range(1, 12)}


BROKER_HOST = "192.168.190.31"
BROKER_PORT = 1883


def get_topic_contamination(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id:02d}/NivContamination"


def get_topic_bdf(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id:02d}/BruitDeFond"


logging.getLogger("werkzeug").setLevel(logging.ERROR)

last_values = default_values()
cm_names = default_names()

mqtt_client = None


def _clean_payload(payload: str) -> str:
    p = (payload or "").strip()
    return p.replace("Bq/cm²", "").strip()


def _validate_device_name(name: str, device_type: str):
    n = (name or "").strip()
    t = (device_type or "").strip()
    if not n:
        return False, "Le nom est obligatoire."
    if t != "CM":
        return False, "Type invalide pour cette page."

    n_upper = n.upper()
    t_upper = t.upper()
    if not n_upper.startswith(t_upper):
        return False, f"Le nom doit commencer par {t}."

    if len(n_upper) == len(t_upper):
        return True, ""

    next_char = n_upper[len(t_upper)]
    if next_char in (" ", "-", "_") or next_char.isdigit():
        return True, ""

    return False, f"Le nom doit commencer par {t}."


def _ensure_cm_mqtt(cm_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    mqtt_client.subscribe(get_topic_contamination(cm_id))
    mqtt_client.subscribe(get_topic_bdf(cm_id))
    mqtt_client.publish(
        get_topic_contamination(cm_id),
        f"{last_values[cm_id]['NivContamination']} Bq/cm²",
        retain=True,
    )
    mqtt_client.publish(
        get_topic_bdf(cm_id),
        f"{last_values[cm_id]['BruitDeFond']} Bq/cm²",
        retain=True,
    )


def _remove_cm_mqtt(cm_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    mqtt_client.publish(get_topic_contamination(cm_id), "", retain=True)
    mqtt_client.publish(get_topic_bdf(cm_id), "", retain=True)
    mqtt_client.unsubscribe(get_topic_contamination(cm_id))
    mqtt_client.unsubscribe(get_topic_bdf(cm_id))


def on_message(client, userdata, msg):
    try:
        payload = _clean_payload(msg.payload.decode("utf-8", errors="ignore"))

        parts = msg.topic.split("/")
        if len(parts) < 4 or not parts[2].startswith("CM_"):
            return

        try:
            cm_id = int(parts[2][3:])
        except ValueError:
            return

        if cm_id < 1:
            return

        if cm_id not in last_values:
            last_values[cm_id] = default_entry()
        if cm_id not in cm_names:
            cm_names[cm_id] = f"CM ID {cm_id}"

        if "NivContamination" in msg.topic:
            last_values[cm_id]["NivContamination"] = payload
        elif "BruitDeFond" in msg.topic:
            last_values[cm_id]["BruitDeFond"] = payload

    except Exception as exc:
        print("MQTT on_message error:", exc)


if USE_MQTT:
    mqtt_client = mqtt.Client(client_id="IHM_ControllerMobile")
    mqtt_client.on_message = on_message
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    for cm_id in range(1, 12):
        _ensure_cm_mqtt(cm_id)

    mqtt_client.loop_start()


@cm_bp.route("/")
def cm_root():
    return redirect(url_for("cm.page_cm", cm_id=1))


@cm_bp.route("/<int:cm_id>")
def page_cm(cm_id: int):
    if cm_id < 1:
        cm_id = 1

    if cm_id not in last_values:
        last_values[cm_id] = default_entry()
    if cm_id not in cm_names:
        cm_names[cm_id] = f"CM ID {cm_id}"

    _ensure_cm_mqtt(cm_id)

    return render_template(
        "cm/CM.html",
        cm_id=cm_id,
        valeur_conta=last_values[cm_id]["NivContamination"],
        valeur_bdf=last_values[cm_id]["BruitDeFond"],
        cm_names=cm_names,
        cm_ids=sorted(cm_names.keys()),
    )


@cm_bp.route("/slider/<int:cm_id>", methods=["POST"])
def slider(cm_id: int):
    if cm_id < 1:
        return "unknown cm_id", 400

    if cm_id not in last_values:
        last_values[cm_id] = default_entry()

    _ensure_cm_mqtt(cm_id)

    value = request.form.get("value")
    type_ = request.form.get("type")
    equip = request.form.get("equip")

    if value is None:
        return "missing value", 400

    type_norm = (type_ or "").strip().lower()

    if type_norm in ("bruit de fond", "bruitdefond"):
        last_values[cm_id]["BruitDeFond"] = value
        topic = get_topic_bdf(cm_id)
        display_type = "Bruit de fond"
    else:
        last_values[cm_id]["NivContamination"] = value
        topic = get_topic_contamination(cm_id)
        display_type = "Contamination"

    print(equip, display_type, "=", value, "Bq/cm²", flush=True)

    if USE_MQTT and mqtt_client:
        mqtt_client.publish(topic, f"{value} Bq/cm²", retain=True)

    return "ok"


@cm_bp.route("/ajouter-appareil", methods=["POST"])
def add_device():
    name = request.form.get("name", "")
    device_type = request.form.get("type", "")

    ok, error = _validate_device_name(name, device_type)
    if not ok:
        return jsonify(ok=False, error=error), 400

    digits = "".join(ch for ch in name if ch.isdigit())
    if not digits:
        return jsonify(ok=False, error="Numero manquant dans le nom."), 400
    if len(digits) > 2:
        return jsonify(ok=False, error="Maximum 2 chiffres (1 a 99)."), 400

    cm_id = int(digits)
    if cm_id < 1 or cm_id > 99:
        return jsonify(ok=False, error="ID CM invalide (1 a 99)."), 400

    cm_names[cm_id] = f"CM ID {cm_id}"
    if cm_id not in last_values:
        last_values[cm_id] = default_entry()
    _ensure_cm_mqtt(cm_id)
    if USE_MQTT and mqtt_client:
        mqtt_client.loop(0.1)

    print(f"Controller Mobile N°{cm_id} a ete cree")

    return jsonify(ok=True)


@cm_bp.route("/supprimer-appareil", methods=["POST"])
def delete_device():
    cm_id_raw = request.form.get("id", "")
    try:
        cm_id = int(cm_id_raw)
    except ValueError:
        return jsonify(ok=False, error="ID invalide."), 400

    if cm_id < 1:
        return jsonify(ok=False, error="ID invalide."), 400

    cm_names.pop(cm_id, None)
    last_values.pop(cm_id, None)
    _remove_cm_mqtt(cm_id)
    if USE_MQTT and mqtt_client:
        mqtt_client.loop(0.1)

    print(f"Controller Mobile N°{cm_id} a ete supprime")

    return jsonify(ok=True)
