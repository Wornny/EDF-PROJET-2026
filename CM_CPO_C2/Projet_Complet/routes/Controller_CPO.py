import logging

from flask import Blueprint, jsonify, redirect, render_template, request, url_for

USE_MQTT = True  # False chez moi sans MQTT et True au lycee
if USE_MQTT:
    import paho.mqtt.client as mqtt

cpo_bp = Blueprint("cpo", __name__, url_prefix="/CPO")


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
    return {i: f"CPO ID {i}" for i in range(1, 3)}


def _sorted_ids(values) -> list[int]:
    def _key(identifier):
        text = str(identifier).strip()
        if text.isdigit():
            return (0, int(text))
        return (1, text)

    return sorted(values, key=_key)


BROKER_HOST = "192.168.190.53"
BROKER_PORT = 8883


def get_topic_contamination(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id}/NivContamination"


def get_topic_bdf(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id}/BruitDeFond"


def _get_legacy_topic_contamination(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id:02d}/NivContamination"


def _get_legacy_topic_bdf(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id:02d}/BruitDeFond"


def _clear_legacy_cpo_topics() -> None:
    if not (USE_MQTT and mqtt_client):
        return

    for cpo_id in range(1, 10):
        legacy_conta = _get_legacy_topic_contamination(cpo_id)
        legacy_bdf = _get_legacy_topic_bdf(cpo_id)
        mqtt_client.publish(legacy_conta, "", retain=True)
        mqtt_client.publish(legacy_bdf, "", retain=True)
        mqtt_client.unsubscribe(legacy_conta)
        mqtt_client.unsubscribe(legacy_bdf)


logging.getLogger("werkzeug").setLevel(logging.ERROR)

last_values = default_values()
cpo_names = default_names()

mqtt_client = None


def _clean_payload(payload: str) -> str:
    p = (payload or "").strip()
    return p.replace("Bq/cm²", "").replace("Bq", "").strip()


def _validate_device_name(name: str, device_type: str):
    n = (name or "").strip()
    t = (device_type or "").strip()
    if not n:
        return False, "Le nom est obligatoire."
    if t != "CPO":
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


def _ensure_cpo_mqtt(cpo_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    topic_conta = get_topic_contamination(cpo_id)
    topic_bdf = get_topic_bdf(cpo_id)
    legacy_conta = _get_legacy_topic_contamination(cpo_id)
    legacy_bdf = _get_legacy_topic_bdf(cpo_id)

    mqtt_client.subscribe(topic_conta)
    mqtt_client.subscribe(topic_bdf)
    mqtt_client.publish(
        topic_conta,
        f"{last_values[cpo_id]['NivContamination']} Bq",
        retain=True,
    )
    mqtt_client.publish(
        topic_bdf,
        f"{last_values[cpo_id]['BruitDeFond']} Bq",
        retain=True,
    )

    if legacy_conta != topic_conta:
        mqtt_client.publish(legacy_conta, "", retain=True)
        mqtt_client.unsubscribe(legacy_conta)
    if legacy_bdf != topic_bdf:
        mqtt_client.publish(legacy_bdf, "", retain=True)
        mqtt_client.unsubscribe(legacy_bdf)


def _remove_cpo_mqtt(cpo_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    topic_conta = get_topic_contamination(cpo_id)
    topic_bdf = get_topic_bdf(cpo_id)
    legacy_conta = _get_legacy_topic_contamination(cpo_id)
    legacy_bdf = _get_legacy_topic_bdf(cpo_id)

    mqtt_client.publish(topic_conta, "", retain=True)
    mqtt_client.publish(topic_bdf, "", retain=True)
    mqtt_client.unsubscribe(topic_conta)
    mqtt_client.unsubscribe(topic_bdf)

    if legacy_conta != topic_conta:
        mqtt_client.publish(legacy_conta, "", retain=True)
        mqtt_client.unsubscribe(legacy_conta)
    if legacy_bdf != topic_bdf:
        mqtt_client.publish(legacy_bdf, "", retain=True)
        mqtt_client.unsubscribe(legacy_bdf)


def on_message(client, userdata, msg):
    try:
        payload = _clean_payload(msg.payload.decode("utf-8", errors="ignore"))

        if "/CPO_" not in msg.topic:
            return

        try:
            cpo_part = msg.topic.split("/")[2]
            cpo_token = cpo_part.replace("CPO_", "")
            if len(cpo_token) > 1 and cpo_token.startswith("0"):
                return
            cpo_id = int(cpo_token)
        except Exception:
            return

        if cpo_id not in (1, 2):
            return

        if "NivContamination" in msg.topic:
            last_values[cpo_id]["NivContamination"] = payload
        elif "BruitDeFond" in msg.topic:
            last_values[cpo_id]["BruitDeFond"] = payload

    except Exception as exc:
        print("MQTT on_message error:", exc)


if USE_MQTT:
    mqtt_client = mqtt.Client(client_id="IHM_CPO")
    mqtt_client.on_message = on_message
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    _clear_legacy_cpo_topics()

    for cpo_id in _sorted_ids(cpo_names.keys()):
        _ensure_cpo_mqtt(cpo_id)

    mqtt_client.loop_start()


@cpo_bp.route("/")
def cpo_root():
    return redirect(url_for("cpo.page_cpo", cpo_id=1))


@cpo_bp.route("/<int:cpo_id>")
def page_cpo(cpo_id: int):
    if cpo_id < 1:
        cpo_id = 1

    if cpo_id not in last_values:
        last_values[cpo_id] = default_entry()
    if cpo_id not in cpo_names:
        cpo_names[cpo_id] = f"CPO ID {cpo_id}"

    _ensure_cpo_mqtt(cpo_id)

    return render_template(
        "cpo/CPO.html",
        cpo_id=cpo_id,
        valeur_conta=last_values[cpo_id]["NivContamination"],
        valeur_bdf=last_values[cpo_id]["BruitDeFond"],
        cpo_names=cpo_names,
        cpo_ids=_sorted_ids(cpo_names.keys()),
    )


@cpo_bp.route("/slider/<int:cpo_id>", methods=["POST"])
def slider(cpo_id: int):
    if cpo_id < 1:
        return "unknown cpo_id", 400

    if cpo_id not in last_values:
        last_values[cpo_id] = default_entry()

    _ensure_cpo_mqtt(cpo_id)

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

    print(equip, display_type, "=", value, "Bq", flush=True)

    if USE_MQTT and mqtt_client:
        mqtt_client.publish(topic, f"{value} Bq", retain=True)

    return "ok"


@cpo_bp.route("/ajouter-appareil", methods=["POST"])
def add_device():
    name = request.form.get("name", "")
    device_type = request.form.get("type", "")

    ok, error = _validate_device_name(name, device_type)
    if not ok:
        return jsonify(ok=False, error=error), 400

    digits = "".join(ch for ch in name if ch.isdigit())
    if not digits:
        return jsonify(ok=False, error="Il manque le numero du nouvel appareil"), 400
    if len(digits) > 2:
        return jsonify(ok=False, error="Maximum 2 chiffres (1 a 99)."), 400

    cpo_id = int(digits)
    if cpo_id < 1 or cpo_id > 99:
        return jsonify(ok=False, error="ID CPO invalide (1 a 99)."), 400

    cpo_names[cpo_id] = f"CPO ID {cpo_id}"
    if cpo_id not in last_values:
        last_values[cpo_id] = default_entry()
    _ensure_cpo_mqtt(cpo_id)
    if USE_MQTT and mqtt_client:
        mqtt_client.loop(0.1)

    print(f"CPO N°{cpo_id} a ete cree")

    return jsonify(ok=True)


@cpo_bp.route("/supprimer-appareil", methods=["POST"])
def delete_device():
    cpo_id_raw = request.form.get("id", "")
    try:
        cpo_id = int(cpo_id_raw)
    except ValueError:
        return jsonify(ok=False, error="ID invalide."), 400

    if cpo_id < 1:
        return jsonify(ok=False, error="ID invalide."), 400

    cpo_names.pop(cpo_id, None)
    last_values.pop(cpo_id, None)
    _remove_cpo_mqtt(cpo_id)
    if USE_MQTT and mqtt_client:
        mqtt_client.loop(0.1)

    print(f"CPO N°{cpo_id} a ete supprime")

    return jsonify(ok=True)
