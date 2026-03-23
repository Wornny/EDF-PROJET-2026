import logging

from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for
from .Controller_login import require_admin_role
from utilisation_ou_non_mqtt import USE_MQTT

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


BROKER_HOST = "192.168.190.38"
BROKER_PORT = 1883
TOPIC_CPO_CONTAMINATION_WILDCARD = "FormaReaEDF/CPO/+/NivContamination"


def topic_contamination(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id}/NivContamination"


def topic_contamination_legacy(cpo_id: int) -> str:
    return f"FormaReaEDF/CPO/CPO_{cpo_id:02d}/NivContamination"


logging.getLogger("werkzeug").setLevel(logging.ERROR)

last_values = charger_valeurs_defaut()
cpo_names = charger_noms_defaut()
deleted_cpo_ids: set[int] = set()

mqtt_client = None


def ids_cpo_actifs() -> list[int]:
    return ids_triees(i for i in cpo_names.keys() if i not in deleted_cpo_ids)


def nettoyer_donnees(payload: str) -> str:
    p = (payload or "").strip()
    return p.replace("Bq/m²", "").replace("Bq/cm²", "").replace("Bq", "").strip()


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
    mqtt_client.publish(
        topic_conta,
        f"{last_values[cpo_id]['NivContamination']}",
        retain=True,
    )


def deconnecter_mqtt_cpo(cpo_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    topic_conta = topic_contamination(cpo_id)
    mqtt_client.publish(topic_conta, "", retain=True)


def on_connect_mqtt_cpo(client, userdata, flags, rc):
    if rc != 0:
        print(f"MQTT connect failed: rc={rc}")
        return

    try:
        result_conta, _ = client.subscribe(TOPIC_CPO_CONTAMINATION_WILDCARD, qos=0)
    except ValueError as exc:
        print(f"MQTT subscribe filter error: {exc}")
        return

    if result_conta != mqtt.MQTT_ERR_SUCCESS:
        print(f"MQTT subscribe failed for {TOPIC_CPO_CONTAMINATION_WILDCARD}: {result_conta}")

    # Cleanup des anciens topics zero-padded (CPO_01..CPO_09) pour eviter les doublons.
    for cpo_id in range(1, 10):
        client.publish(topic_contamination_legacy(cpo_id), "", retain=True)

    # Publier tous les CPO actifs dès la connexion établie
    for cpo_id in ids_cpo_actifs():
        client.publish(topic_contamination(cpo_id), f"{last_values.get(cpo_id, entree_par_defaut())['NivContamination']}", retain=True)


def traiter_message_mqtt(client, userdata, msg):
    try:
        payload = nettoyer_donnees(msg.payload.decode("utf-8", errors="ignore"))

        parts = msg.topic.split("/")
        if len(parts) < 4 or not parts[2].startswith("CPO_"):
            return

        try:
            cpo_token = parts[2][4:]
            if len(cpo_token) > 1 and cpo_token.startswith("0"):
                return
            cpo_id = int(cpo_token)
        except ValueError:
            return

        if cpo_id < 1:
            return

        # Ne pas recreer automatiquement un ID explicitement supprime.
        if cpo_id in deleted_cpo_ids:
            return

        if cpo_id not in last_values:
            last_values[cpo_id] = entree_par_defaut()
        if cpo_id not in cpo_names:
            cpo_names[cpo_id] = f"CPO ID {cpo_id}"

        if msg.topic.lower().endswith("/nivcontamination"):
            last_values[cpo_id]["NivContamination"] = payload

    except Exception as exc:
        print("MQTT on_message error:", exc)


if USE_MQTT:
    mqtt_client = mqtt.Client(client_id="IHM_CPO", protocol=mqtt.MQTTv311)
    mqtt_client.on_connect = on_connect_mqtt_cpo
    mqtt_client.on_message = traiter_message_mqtt
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    mqtt_client.loop_start()


@cpo_bp.route("/")
def accueil_cpo():
    return redirect(url_for("cpo.afficher_page_cpo", cpo_id=1))


@cpo_bp.route("/<int:cpo_id>")
def afficher_page_cpo(cpo_id: int):
    if cpo_id < 1:
        cpo_id = 1

    if cpo_id in deleted_cpo_ids:
        actifs = ids_cpo_actifs()
        cible = actifs[0] if actifs else 1
        return redirect(url_for("cpo.afficher_page_cpo", cpo_id=cible))

    if cpo_id not in last_values:
        last_values[cpo_id] = entree_par_defaut()
    if cpo_id not in cpo_names:
        cpo_names[cpo_id] = f"CPO ID {cpo_id}"

    initialiser_mqtt_cpo(cpo_id)

    return render_template(
        "cpo/CPO.html",
        cpo_id=cpo_id,
        valeur_conta=last_values[cpo_id]["NivContamination"],
        cpo_names=cpo_names,
        cpo_ids=ids_cpo_actifs(),
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
    equip = request.form.get("equip")

    if value is None:
        return "missing value", 400

    last_values[cpo_id]["NivContamination"] = value
    topic = topic_contamination(cpo_id)
    display_type = "Contamination"

    print(equip, display_type, "=", value, "", flush=True)

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
    deleted_cpo_ids.discard(cpo_id)
    if cpo_id not in last_values:
        last_values[cpo_id] = entree_par_defaut()
    initialiser_mqtt_cpo(cpo_id)

    print(f"CPO ID {cpo_id} a été créé")

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

    deleted_cpo_ids.add(cpo_id)
    cpo_names.pop(cpo_id, None)
    last_values.pop(cpo_id, None)
    deconnecter_mqtt_cpo(cpo_id)

    print(f"CPO ID {cpo_id} a été supprimé")

    return jsonify(ok=True)


@cpo_bp.route("/state/<int:cpo_id>")
def obtenir_etat(cpo_id: int):
    if cpo_id < 1:
        return jsonify(ok=False, error="ID invalide."), 400

    if cpo_id not in last_values:
        last_values[cpo_id] = entree_par_defaut()

    entry = last_values[cpo_id]
    contamination = str(entry.get("NivContamination", "1"))

    response = jsonify(
        ok=True,
        cpo_id=cpo_id,
        NivContamination=contamination,
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response
