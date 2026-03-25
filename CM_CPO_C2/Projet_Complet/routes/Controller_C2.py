import re
import json
import uuid
from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for
from .Controller_login import require_admin_role
from utilisation_ou_non_mqtt import USE_MQTT

if USE_MQTT:
	import paho.mqtt.client as mqtt

c2_bp = Blueprint("c2", __name__, url_prefix="/C2")

BROKER_HOST = "192.168.190.38"
BROKER_PORT = 1883
TOPIC_C2_CAPTEURS_LEGACY = "FormaReaEDF/C2/+/Capteurs"
TOPIC_C2_CAPTEURS_FACE = "FormaReaEDF/C2/+/CapteursFace"
TOPIC_C2_CAPTEURS_DOS = "FormaReaEDF/C2/+/CapteursDos"

mqtt_client = None
c2_names = {1: "C2 ID 1", 2: "C2 ID 2"}
c2_values = {}


def normaliser_liste_numerique(values):
	if not isinstance(values, list):
		return []

	result = []
	for value in values:
		try:
			result.append(int(value))
		except (TypeError, ValueError):
			continue

	return sorted(set(result))


def parser_liste_capteurs_texte(raw: str):
	text = (raw or "").strip()
	if not text:
		return []

	# Nouveau format trame: "$01;02;...;28,00"
	# On retire le '$' de debut puis on ne garde que la partie avant la virgule de fin.
	if text.startswith("$"):
		text = text[1:]
	if "," in text:
		text = text.split(",", 1)[0]

	values = []
	for token in re.findall(r"\d+",text):
		try:
			value = int(token)
			if value >= 1:
				values.append(value)
		except (TypeError, ValueError):
			continue

	return sorted(set(values))


def extraire_ids_capteurs_numeriques(values: dict, prefix: str):
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


def formater_tableau(values):
	if not values:
		return "$00"

	formatted = [f"{int(v):02d}" for v in values]
	return f"${';'.join(formatted)};00"


def entree_c2_defaut():
	return {"F": [], "D": []}


def analyser_charge_capteurs(payload: str):
	text = (payload or "").strip()
	if not text:
		return [], []

	# 1) Format JSON (ex: {"c2_id":"C2_1","capteurs":{"FACE":{...},"DOS":{...}}}
	#    ou {"F":[...],"D":[...]})
	try:
		obj = json.loads(text)
		if isinstance(obj, dict):
			if "capteurs" in obj and isinstance(obj.get("capteurs"), dict):
				capteurs = obj.get("capteurs", {})
				face_values = capteurs.get("FACE", {}) or {}
				dos_values = capteurs.get("DOS", {}) or {}
				f_values = extraire_ids_capteurs_numeriques(face_values, "c")
				d_values = extraire_ids_capteurs_numeriques(dos_values, "dos")
				return f_values, d_values

			f_values = normaliser_liste_numerique(obj.get("F", []))
			d_values = normaliser_liste_numerique(obj.get("D", []))
			if f_values or d_values:
				return f_values, d_values
	except Exception:
		pass

	def _parse_array(raw: str):
		if raw is None:
			return []
		parts = [p.strip() for p in re.split(r"[;,]", raw) if p.strip()]
		values = []
		for part in parts:
			try:
				values.append(int(part))
			except ValueError:
				continue
		return sorted(set(values))

	match_f = re.search(r'"F"\s*:\s*\[([^\]]*)\]', text)
	match_d = re.search(r'"D"\s*:\s*\[([^\]]*)\]', text)

	f_values = _parse_array(match_f.group(1) if match_f else "")
	d_values = _parse_array(match_d.group(1) if match_d else "")

	return f_values, d_values


def extraire_id_numerique_c2(c2_token: str):
	token = (c2_token or "").strip()
	if not token:
		return None

	# Format attendu le plus courant: C2_1, C2-1, C2 1
	prefixed = re.match(r"(?i)^C2[\s_-]*(\d+)$", token)
	if prefixed:
		try:
			return int(prefixed.group(1))
		except ValueError:
			return None

	# Fallback: prendre le dernier groupe de chiffres
	matches = re.findall(r"\d+", token)
	if not matches:
		return None
	try:
		return int(matches[-1])
	except ValueError:
		return None


def valider_nom_appareil(name: str, device_type: str):
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


def extraire_id_appareil(name: str, device_type: str):
	n = (name or "").strip()
	t = (device_type or "").strip()
	if not n or not t:
		return None

	n_upper = n.upper()
	t_upper = t.upper()
	if not n_upper.startswith(t_upper):
		return None

	remainder = n[len(t):].strip()
	if remainder.startswith(("-", "_")):
		remainder = remainder[1:].strip()

	match = re.search(r"\d+", remainder)
	if not match:
		return None

	try:
		return int(match.group(0))
	except ValueError:
		return None


if USE_MQTT:
	mqtt_client = mqtt.Client(client_id=f"IHM_C2_{uuid.uuid4().hex[:8]}")

	def connecter_mqtt(client, userdata, flags, rc):
		try:
			client.subscribe(TOPIC_C2_CAPTEURS_LEGACY)
			client.subscribe(TOPIC_C2_CAPTEURS_FACE)
			client.subscribe(TOPIC_C2_CAPTEURS_DOS)
			print(f"C2 MQTT connected (rc={rc}) and subscribed", flush=True)
		except Exception as exc:
			print("MQTT on_connect subscribe error:", exc)

	def traiter_message_mqtt(client, userdata, msg):
		try:
			parts = msg.topic.split("/")
			if len(parts) < 4:
				return
			c2_id = extraire_id_numerique_c2(parts[2])
			if c2_id is None or c2_id < 1:
				return

			payload = msg.payload.decode("utf-8", errors="ignore")
			topic_suffix = parts[3].strip().lower()

			if c2_id not in c2_values:
				c2_values[c2_id] = entree_c2_defaut()

			if topic_suffix == "capteursface":
				c2_values[c2_id]["F"] = parser_liste_capteurs_texte(payload)
			elif topic_suffix == "capteursdos":
				c2_values[c2_id]["D"] = parser_liste_capteurs_texte(payload)
			else:
				# Compatibilite avec l'ancien topic unique "Capteurs".
				f_values, d_values = analyser_charge_capteurs(payload)
				c2_values[c2_id] = {"F": f_values, "D": d_values}

			if c2_id not in c2_names:
				c2_names[c2_id] = f"C2 ID {c2_id}"
		except Exception as exc:
			print("MQTT on_message error:", exc)

	mqtt_client.on_connect = connecter_mqtt
	mqtt_client.on_message = traiter_message_mqtt
	mqtt_client.username_pw_set("client", "normandie765")
	mqtt_client.reconnect_delay_set(min_delay=1, max_delay=30)
	try:
		mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
		mqtt_client.loop_start()
	except Exception as exc:
		print("MQTT connect error:", exc)


@c2_bp.route("/")
def accueil_c2():
	return redirect(url_for("c2.afficher_page_c2", c2_id=1))


@c2_bp.route("/<int:c2_id>")
def afficher_page_c2(c2_id: int):
	if c2_id < 1:
		c2_id = 1

	if c2_id not in c2_names:
		c2_names[c2_id] = f"C2 ID {c2_id}"
	if c2_id not in c2_values:
		c2_values[c2_id] = entree_c2_defaut()

	return render_template(
		"c2/C2.html",
		c2_id=c2_id,
		c2_names=c2_names,
		c2_ids=sorted(c2_names.keys()),
		role=session.get("role", "user")
	)


@c2_bp.route("/publish_capteurs_full", methods=["POST"])
def publier_capteurs_complet():
	# Nouveau format attendu: requete non-JSON (FormData / x-www-form-urlencoded)
	raw_c2_id = request.form.get("c2_id") or request.values.get("c2_id")
	raw_f = request.form.get("F")
	raw_d = request.form.get("D")

	if raw_c2_id is None and request.is_json:
		# Compatibilite legacy JSON.
		data = request.get_json(silent=True) or {}
		raw_c2_id = data.get("c2_id")

		f_list = data.get("F")
		d_list = data.get("D")

		if f_list is None or d_list is None:
			capteurs = data.get("capteurs", {}) or {}
			face_values = capteurs.get("FACE", {}) or {}
			dos_values = capteurs.get("DOS", {}) or {}

			f_list = extraire_ids_capteurs_numeriques(face_values, "c")
			d_list = extraire_ids_capteurs_numeriques(dos_values, "dos")
		else:
			f_list = normaliser_liste_numerique(f_list)
			d_list = normaliser_liste_numerique(d_list)
	else:
		f_list = parser_liste_capteurs_texte(raw_f)
		d_list = parser_liste_capteurs_texte(raw_d)

	c2_token_input = str(raw_c2_id or "C2_1")
	c2_numeric_id = extraire_id_numerique_c2(c2_token_input)
	c2_token = f"C2_{c2_numeric_id}" if c2_numeric_id is not None and c2_numeric_id >= 1 else c2_token_input

	if c2_numeric_id is not None and c2_numeric_id >= 1:
		c2_values[c2_numeric_id] = {"F": f_list, "D": d_list}
		if c2_numeric_id not in c2_names:
			c2_names[c2_numeric_id] = f"C2 ID {c2_numeric_id}"

	topic_face = f"FormaReaEDF/C2/{c2_token}/CapteursFace"
	topic_dos = f"FormaReaEDF/C2/{c2_token}/CapteursDos"
	payload_face = formater_tableau(f_list)
	payload_dos = formater_tableau(d_list)

	if USE_MQTT and mqtt_client:
		try:
			mqtt_client.publish(topic_face, payload_face, qos=1, retain=True)
			mqtt_client.publish(topic_dos, payload_dos, qos=1, retain=True)
		except Exception as exc:
			print("MQTT publish error:", exc)
			return jsonify({"status": "error", "error": "mqtt_publish_failed"}), 500

	return jsonify({
		"status": "ok",
		"topic_face": topic_face,
		"topic_dos": topic_dos,
		"payload_face": payload_face,
		"payload_dos": payload_dos,
	}), 200


@c2_bp.route("/ajouter-appareil", methods=["POST"])
@require_admin_role()
def ajouter_appareil():
	name = request.form.get("name", "")
	device_type = request.form.get("type", "")

	ok, error = valider_nom_appareil(name, device_type)
	if not ok:
		return jsonify(ok=False, error=error), 400

	c2_id = extraire_id_appareil(name, device_type)
	if c2_id is None:
		return jsonify(ok=False, error="Numero manquant dans le nom."), 400
	if c2_id > 99:
		return jsonify(ok=False, error="Maximum 2 chiffres (1 a 99)."), 400
	if c2_id < 1 or c2_id > 99:
		return jsonify(ok=False, error="ID C2 invalide (1 a 99)."), 400

	c2_names[c2_id] = f"C2 ID {c2_id}"
	if c2_id not in c2_values:
		c2_values[c2_id] = entree_c2_defaut()

	print(f"C2 No{c2_id} a ete cree")

	return jsonify(ok=True)


@c2_bp.route("/supprimer-appareil", methods=["POST"])
@require_admin_role()
def supprimer_appareil():
	c2_id_raw = request.form.get("id", "")
	try:
		c2_id = int(c2_id_raw)
	except ValueError:
		return jsonify(ok=False, error="ID invalide."), 400

	if c2_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	c2_names.pop(c2_id, None)
	c2_values.pop(c2_id, None)

	print(f"C2 No{c2_id} a ete supprime")

	return jsonify(ok=True)


@c2_bp.route("/state/<int:c2_id>")
def obtenir_etat(c2_id: int):
	if c2_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	entry = c2_values.get(c2_id)
	if entry is None:
		entry = entree_c2_defaut()
		c2_values[c2_id] = entry

	response = jsonify(
		ok=True,
		c2_id=f"C2_{c2_id}",
		F=normaliser_liste_numerique(entry.get("F", [])),
		D=normaliser_liste_numerique(entry.get("D", [])),
	)
	response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
	response.headers["Pragma"] = "no-cache"
	response.headers["Expires"] = "0"
	return response
