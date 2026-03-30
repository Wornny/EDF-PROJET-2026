import logging

from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for
from .Controller_login import require_admin_role
from utilisation_ou_non_mqtt_mysql import USE_MQTT

if USE_MQTT:
    import paho.mqtt.client as mqtt

cm_bp = Blueprint("cm", __name__, url_prefix="/ControllerMobile")


def charger_valeurs_defaut():
    values = {}
    for i in range(1, 12):
        values[i] = entree_par_defaut()
    return values


def entree_par_defaut():
    return {
        "NivContamination": "1",
        "Status": "0",
    }


def charger_noms_defaut():
    return {i: f"CM ID {i}" for i in range(1, 12)}


def ids_triees(values) -> list[int]:
    def cle_tri(identifier):
        text = str(identifier).strip()
        if text.isdigit():
            return (0, int(text))
        return (1, text)

    return sorted(values, key=cle_tri)


BROKER_HOST = "192.168.191.14"
BROKER_PORT = 51883
TOPIC_CM_CONTAMINATION_WILDCARD = "FormaReaEDF/ControllerMobile/+/NivContamination"
TOPIC_CM_STATUS_WILDCARD = "FormaReaEDF/ControllerMobile/+/Status"


def topic_contamination(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id}/NivContamination"


def topic_status(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id}/Status"


def topic_contamination_legacy(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id:02d}/NivContamination"


def topic_status_legacy(cm_id: int) -> str:
    return f"FormaReaEDF/ControllerMobile/CM_{cm_id:02d}/Status"


logging.getLogger("werkzeug").setLevel(logging.ERROR)

last_values = charger_valeurs_defaut()
cm_names = charger_noms_defaut()
deleted_cm_ids: set[int] = set()

mqtt_client = None


def ids_cm_actifs() -> list[int]:
    return ids_triees(i for i in cm_names.keys() if i not in deleted_cm_ids)


def nettoyer_donnees(payload: str) -> str:
    p = (payload or "").strip()
    return p.replace("Bq/m2", "").replace("Bq/cm2", "").replace("Bq", "").strip()


def valider_nom_appareil(name: str, device_type: str):
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


def initialiser_mqtt_cm(cm_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    last_values[cm_id].setdefault("Status", "0")

    topic_conta = topic_contamination(cm_id)
    topic_statut = topic_status(cm_id)
    mqtt_client.publish(
        topic_conta,
        f"{last_values[cm_id]['NivContamination']}",
        retain=True,
    )
    mqtt_client.publish(
        topic_statut,
        f"{last_values[cm_id]['Status']}",
        retain=True,
    )


def deconnecter_mqtt_cm(cm_id: int):
    if not (USE_MQTT and mqtt_client):
        return

    topic_conta = topic_contamination(cm_id)
    topic_statut = topic_status(cm_id)

    mqtt_client.publish(topic_conta, "", retain=True)
    mqtt_client.publish(topic_statut, "", retain=True)


def on_connect_mqtt_cm(client, userdata, flags, rc):
    if rc != 0:
        print(f"MQTT connect failed: rc={rc}")
        return

    try:
        result_conta, _ = client.subscribe(TOPIC_CM_CONTAMINATION_WILDCARD, qos=0)
        result_status, _ = client.subscribe(TOPIC_CM_STATUS_WILDCARD, qos=0)
    except ValueError as exc:
        print(f"MQTT subscribe filter error: {exc}")
        return

    if result_conta != mqtt.MQTT_ERR_SUCCESS:
        print(f"MQTT subscribe failed for {TOPIC_CM_CONTAMINATION_WILDCARD}: {result_conta}")
    if result_status != mqtt.MQTT_ERR_SUCCESS:
        print(f"MQTT subscribe failed for {TOPIC_CM_STATUS_WILDCARD}: {result_status}")

    # Publier les valeurs par defaut de tous les CM au demarrage (une seule fois)
    for cm_id in list(last_values.keys()):
        if cm_id not in deleted_cm_ids:
            initialiser_mqtt_cm(cm_id)


def traiter_message_mqtt(client, userdata, msg):
    try:
        payload = nettoyer_donnees(msg.payload.decode("utf-8", errors="ignore"))

        parts = msg.topic.split("/")
        if len(parts) < 4 or not parts[2].startswith("CM_"):
            return

        try:
            cm_token = parts[2][3:]
            if len(cm_token) > 1 and cm_token.startswith("0"):
                return
            cm_id = int(cm_token)
        except ValueError:
            return

        if cm_id < 1:
            return

        # Ne pas recreer automatiquement un ID explicitement supprime ou inconnu.
        if cm_id in deleted_cm_ids:
            return
        if cm_id not in cm_names:
            return

        if cm_id not in last_values:
            last_values[cm_id] = entree_par_defaut()

        if "NivContamination" in msg.topic:
            last_values[cm_id]["NivContamination"] = payload
        elif msg.topic.lower().endswith("/status"):
            last_values[cm_id]["Status"] = "1" if str(payload).strip() == "1" else "0"

    except Exception as exc:
        print("MQTT on_message error:", exc)


if USE_MQTT:
    mqtt_client = mqtt.Client(client_id="IHM_ControllerMobile", protocol=mqtt.MQTTv311)
    mqtt_client.on_connect = on_connect_mqtt_cm
    mqtt_client.on_message = traiter_message_mqtt
    mqtt_client.username_pw_set("client", "normandie765")
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    mqtt_client.loop_start()


@cm_bp.route("/")
def accueil_cm():
    return redirect(url_for("cm.afficher_page_cm", cm_id=1))


@cm_bp.route("/<int:cm_id>")
def afficher_page_cm(cm_id: int):
    if cm_id < 1:
        cm_id = 1

    if cm_id in deleted_cm_ids:
        actifs = ids_cm_actifs()
        cible = actifs[0] if actifs else 1
        return redirect(url_for("cm.afficher_page_cm", cm_id=cible))

    if cm_id not in last_values:
        last_values[cm_id] = entree_par_defaut()
    if cm_id not in cm_names:
        cm_names[cm_id] = f"CM ID {cm_id}"
    last_values[cm_id].setdefault("Status", "0")

    return render_template(
        "cm/CM.html",
        cm_id=cm_id,
        valeur_conta=last_values[cm_id]["NivContamination"],
        cm_names=cm_names,
        cm_ids=ids_cm_actifs(),
        role=session.get("role", "user")
    )


@cm_bp.route("/slider/<int:cm_id>", methods=["POST"])
def slider(cm_id: int):
    if cm_id < 1:
        return "unknown cm_id", 400

    if cm_id not in last_values:
        last_values[cm_id] = entree_par_defaut()
    last_values[cm_id].setdefault("Status", "0")

    value = request.form.get("value")
    type_ = request.form.get("type")
    equip = request.form.get("equip")

    if value is None:
        return "missing value", 400

    type_norm = (type_ or "").strip().lower()

    if type_norm in ("status", "statut"):
        normalized_status = "1" if str(value).strip() == "1" else "0"
        last_values[cm_id]["Status"] = normalized_status
        topic = topic_status(cm_id)
        display_type = "Status"
        value_to_publish = normalized_status
    else:
        last_values[cm_id]["NivContamination"] = value
        topic = topic_contamination(cm_id)
        display_type = "Contamination"
        value_to_publish = value

    print(equip, display_type, "=", value_to_publish, "", flush=True)

    if USE_MQTT and mqtt_client:
        mqtt_client.publish(topic, f"{value_to_publish}", retain=True)

    return "ok"


@cm_bp.route("/ajouter-appareil", methods=["POST"])
@require_admin_role()
def ajouter_appareil():
    name = request.form.get("name", "")
    device_type = request.form.get("type", "")

    ok, error = valider_nom_appareil(name, device_type)
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
    deleted_cm_ids.discard(cm_id)
    if cm_id not in last_values:
        last_values[cm_id] = entree_par_defaut()
    initialiser_mqtt_cm(cm_id)

    print(f"Controller Mobile No{cm_id} a ete cree")

    return jsonify(ok=True)


@cm_bp.route("/supprimer-appareil", methods=["POST"])
@require_admin_role()
def supprimer_appareil():
    cm_id_raw = request.form.get("id", "")
    try:
        cm_id = int(cm_id_raw)
    except ValueError:
        return jsonify(ok=False, error="ID invalide."), 400

    if cm_id < 1:
        return jsonify(ok=False, error="ID invalide."), 400

    deleted_cm_ids.add(cm_id)
    cm_names.pop(cm_id, None)
    last_values.pop(cm_id, None)
    deconnecter_mqtt_cm(cm_id)

    print(f"Controller Mobile No{cm_id} a ete supprime")

    return jsonify(ok=True)


@cm_bp.route("/state/<int:cm_id>")
def obtenir_etat(cm_id: int):
    if cm_id < 1:
        return jsonify(ok=False, error="ID invalide."), 400

    if cm_id not in last_values:
        last_values[cm_id] = entree_par_defaut()

    entry = last_values[cm_id]
    contamination = str(entry.get("NivContamination", "1"))
    status = "1" if str(entry.get("Status", "0")).strip() == "1" else "0"

    response = jsonify(
        ok=True,
        cm_id=cm_id,
        NivContamination=contamination,
        Status=status,
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response
