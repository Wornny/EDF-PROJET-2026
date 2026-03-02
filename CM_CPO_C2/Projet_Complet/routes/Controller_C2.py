from flask import Blueprint, jsonify, redirect, render_template, request, url_for

USE_MQTT = True  # False chez moi sans MQTT et True au lycee
if USE_MQTT:
	import paho.mqtt.client as mqtt

c2_bp = Blueprint("c2", __name__, url_prefix="/C2")

BROKER_HOST = "192.168.190.31"
BROKER_PORT = 1883

mqtt_client = None


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
	return render_template("c2/C2.html", c2_id=c2_id)


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

	if USE_MQTT and mqtt_client:
		mqtt_client.publish(topic, payload, qos=1, retain=True)
		mqtt_client.loop(0.1)

	return jsonify({"status": "ok"}), 200
