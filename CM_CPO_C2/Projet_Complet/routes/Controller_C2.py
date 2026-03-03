from flask import Blueprint, jsonify, redirect, render_template, request, url_for

USE_MQTT = True  # False chez moi sans MQTT et True au lycee
if USE_MQTT:
	import paho.mqtt.client as mqtt

c2_bp = Blueprint("c2", __name__, url_prefix="/C2")

BROKER_HOST = "192.168.190.31"
BROKER_PORT = 1883

mqtt_client = None
c2_names = {1: "C2 ID 1", 2: "C2 ID 2"}


def _normalize_numeric_list(values):
	if not isinstance(values, list):
		return []

	result = []
	for value in values:
		try:
			result.append(int(value))
		except (TypeError, ValueError):
			continue

	return sorted(set(result))


def _extract_numeric_sensor_ids(values: dict, prefix: str):
	ids = []
	if not isinstance(values, dict):
		return ids

	for key, is_active in values.items():
		if not is_active:
			continue
		if not isinstance(key, str) or not key.startswith(prefix):
			continue

		digits = "".join(ch for ch in key if ch.isdigit())
		if not digits:
			continue

		ids.append(int(digits))

	return sorted(set(ids))


def _format_array(values):
	if not values:
		return "[]"
	joined = "; ".join(str(int(v)) for v in values)
	return f"[{joined}]"


def _validate_device_name(name: str, device_type: str):
	n = (name or "").strip()
	t = (device_type or "").strip()
	if not n:
		return False, "Le nom est obligatoire."
	if t != "C2":
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


if USE_MQTT:
	mqtt_client = mqtt.Client(client_id="IHM_C2")
	mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
	mqtt_client.loop_start()


@c2_bp.route("/")
def c2_root():
	return redirect(url_for("c2.c2_page", c2_id=1))


@c2_bp.route("/<int:c2_id>")
def c2_page(c2_id: int):
	if c2_id < 1:
		c2_id = 1

	if c2_id not in c2_names:
		c2_names[c2_id] = f"C2 ID {c2_id}"

	return render_template(
		"c2/C2.html",
		c2_id=c2_id,
		c2_names=c2_names,
		c2_ids=sorted(c2_names.keys()),
	)


@c2_bp.route("/publish_capteurs_full", methods=["POST"])
def publish_capteurs_full():
	data = request.get_json(silent=True) or {}

	c2_id = data.get("c2_id")
	if not c2_id:
		c2_id = "C2_1"

	# Compatibilité double format :
	# 1) ancien format {"F": [...], "D": [...]} ;
	# 2) nouveau format {"capteurs": {"FACE": {"c1": true}, "DOS": {"dos1": true}}}
	f_list = data.get("F")
	d_list = data.get("D")

	if f_list is None or d_list is None:
		capteurs = data.get("capteurs", {}) or {}
		face_values = capteurs.get("FACE", {}) or {}
		dos_values = capteurs.get("DOS", {}) or {}

		f_list = _extract_numeric_sensor_ids(face_values, "c")
		d_list = _extract_numeric_sensor_ids(dos_values, "dos")
	else:
		f_list = _normalize_numeric_list(f_list)
		d_list = _normalize_numeric_list(d_list)

	topic = f"FormaReaEDF/C2/{c2_id}/Capteurs"
	payload = f'{{"F": {_format_array(f_list)}, "D": {_format_array(d_list)}}}'

	print(f"{c2_id} Capteurs = {payload}", flush=True)

	if USE_MQTT and mqtt_client:
		mqtt_client.publish(topic, payload, qos=1, retain=True)
		mqtt_client.loop(0.1)

	return jsonify({"status": "ok"}), 200


@c2_bp.route("/ajouter-appareil", methods=["POST"])
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

	c2_id = int(digits)
	if c2_id < 1 or c2_id > 99:
		return jsonify(ok=False, error="ID C2 invalide (1 a 99)."), 400

	c2_names[c2_id] = f"C2 ID {c2_id}"

	print(f"C2 N°{c2_id} a ete cree")

	return jsonify(ok=True)


@c2_bp.route("/supprimer-appareil", methods=["POST"])
def delete_device():
	c2_id_raw = request.form.get("id", "")
	try:
		c2_id = int(c2_id_raw)
	except ValueError:
		return jsonify(ok=False, error="ID invalide."), 400

	if c2_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	c2_names.pop(c2_id, None)

	print(f"C2 N°{c2_id} a ete supprime")

	return jsonify(ok=True)
