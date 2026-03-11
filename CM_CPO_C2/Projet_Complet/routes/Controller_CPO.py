import logging

from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for
from .Controller_login import require_admin_role

USE_MQTT = True  # False chez moi sans MQTT et True au lycee
if USE_MQTT:
    import paho.mqtt.client as mqtt

cpo_bp = Blueprint("cpo", __name__, url_prefix="/CPO")


def charger_valeurs_defaut():
    values = {}
    for i in range(1, 12):
        values[i] = entree_par_defaut()
    return values


def entree_par_defaut():
    return {
        "NivContamination": "1",
        "BruitDeFond": "0.50",
    }


def charger_noms_defaut():
    return {i: f"CPO ID {i}" for i in range(1, 5)}


def ids_triees(values) -> list[int]:
    def cle_tri(identifier):
        text = str(identifier).strip()
        if text.isdigit():
            return (0, int(text))
        return (1, text)

    return sorted(values, key=cle_tri)


BROKER_HOST = "192.168.10.3"
BROKER_PORT = 1883


def topic_contamination(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id}/NivContamination"


def topic_bruit_fond(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id}/BruitDeFond"


def topic_ancien_contamination(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id:02d}/NivContamination"


def topic_ancien_bruit_fond(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id:02d}/BruitDeFond"


def nettoyer_anciens_topics_cpo() -> None:
    if not (USE_MQTT and mqtt_client):
        return

    for cpo_id in range(1, 10):
        legacy_conta = topic_ancien_contamination(cpo_id)
        legacy_bdf = topic_ancien_bruit_fond(cpo_id)
        mqtt_client.publish(legacy_conta, "", retain=True)
        mqtt_client.publish(legacy_bdf, "", retain=True)
        mqtt_client.unsubscribe(legacy_conta)
        mqtt_client.unsubscribe(legacy_bdf)


logging.getLogger("werkzeug").setLevel(logging.ERROR)

last_values = charger_valeurs_defaut()
cpo_names = charger_noms_defaut()

mqtt_client = None


def nettoyer_donnees(payload: str) -> str:
    p = (payload or "").strip()
    return p.replace("Bq/cm²", "").replace("Bq", "").strip()


def valider_nom_appareil(name: str, device_type: str):
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


def initialiser_mqtt_cpo(cpo_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    topic_conta = topic_contamination(cpo_id)
    topic_bdf = topic_bruit_fond(cpo_id)
    legacy_conta = topic_ancien_contamination(cpo_id)
    legacy_bdf = topic_ancien_bruit_fond(cpo_id)

    mqtt_client.subscribe(topic_conta)
    mqtt_client.subscribe(topic_bdf)
    mqtt_client.publish(
        topic_conta,
        f"{last_values[cpo_id]['NivContamination']}",
        retain=True,
    )
    mqtt_client.publish(
        topic_bdf,
        f"{last_values[cpo_id]['BruitDeFond']}",
        retain=True,
    )

    if legacy_conta != topic_conta:
        mqtt_client.publish(legacy_conta, "", retain=True)
        mqtt_client.unsubscribe(legacy_conta)
    if legacy_bdf != topic_bdf:
        mqtt_client.publish(legacy_bdf, "", retain=True)
        mqtt_client.unsubscribe(legacy_bdf)


def deconnecter_mqtt_cpo(cpo_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    topic_conta = topic_contamination(cpo_id)
    topic_bdf = topic_bruit_fond(cpo_id)
    legacy_conta = topic_ancien_contamination(cpo_id)
    legacy_bdf = topic_ancien_bruit_fond(cpo_id)

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


def traiter_message_mqtt(client, userdata, msg):
    try:
        payload = nettoyer_donnees(msg.payload.decode("utf-8", errors="ignore"))

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
    mqtt_client.on_message = traiter_message_mqtt
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    nettoyer_anciens_topics_cpo()

    for cpo_id in ids_triees(cpo_names.keys()):
        initialiser_mqtt_cpo(cpo_id)

    mqtt_client.loop_start()


@cpo_bp.route("/")
def accueil_cpo():
    return redirect(url_for("cpo.afficher_page_cpo", cpo_id=1))


@cpo_bp.route("/<int:cpo_id>")
def afficher_page_cpo(cpo_id: int):
    if cpo_id < 1:
        cpo_id = 1

    if cpo_id not in last_values:
        last_values[cpo_id] = entree_par_defaut()
    if cpo_id not in cpo_names:
        cpo_names[cpo_id] = f"CPO ID {cpo_id}"

    initialiser_mqtt_cpo(cpo_id)

    return render_template(
        "cpo/CPO.html",
        cpo_id=cpo_id,
        valeur_conta=last_values[cpo_id]["NivContamination"],
        valeur_bdf=last_values[cpo_id]["BruitDeFond"],
        cpo_names=cpo_names,
        cpo_ids=ids_triees(cpo_names.keys()),
        role=session.get("role", "user")
    )


@cpo_bp.route("/slider/<int:cpo_id>", methods=["POST"])
def traiter_jauge(cpo_id: int):
    if cpo_id < 1:
        return "unknown cpo_id", 400

    if cpo_id not in last_values:
        last_values[cpo_id] = entree_par_defaut()

    initialiser_mqtt_cpo(cpo_id)

    value = request.form.get("value")
    type_ = request.form.get("type")
    equip = request.form.get("equip")

    if value is None:
        return "missing value", 400

    type_norm = (type_ or "").strip().lower()

    if "bruit" in type_norm:
        last_values[cpo_id]["BruitDeFond"] = value
        topic = topic_bruit_fond(cpo_id)
        display_type = "Bruit de fond"
    else:
        last_values[cpo_id]["NivContamination"] = value
        topic = topic_contamination(cpo_id)
        display_type = "Contamination"

    print(equip, display_type, "=", value, "Bq", flush=True)

    if USE_MQTT and mqtt_client:
        mqtt_client.publish(topic, f"{value}", retain=True)

    return "ok"


@cpo_bp.route("/ajouter-appareil", methods=["POST"])
@require_admin_role()
def ajouter_appareil():
    name = request.form.get("name", "")
    device_type = request.form.get("type", "")

    ok, error = valider_nom_appareil(name, device_type)
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
        last_values[cpo_id] = entree_par_defaut()
    initialiser_mqtt_cpo(cpo_id)
    if USE_MQTT and mqtt_client:
        mqtt_client.loop(0.1)

    print(f"CPO N°{cpo_id} a ete cree")

    return jsonify(ok=True)


@cpo_bp.route("/supprimer-appareil", methods=["POST"])
@require_admin_role()
def supprimer_appareil():
    cpo_id_raw = request.form.get("id", "")
    try:
        cpo_id = int(cpo_id_raw)
    except ValueError:
        return jsonify(ok=False, error="ID invalide."), 400

    if cpo_id < 1:
        return jsonify(ok=False, error="ID invalide."), 400

    cpo_names.pop(cpo_id, None)
    last_values.pop(cpo_id, None)
    deconnecter_mqtt_cpo(cpo_id)
    if USE_MQTT and mqtt_client:
        mqtt_client.loop(0.1)

    print(f"CPO N°{cpo_id} a ete supprime")

    return jsonify(ok=True)
