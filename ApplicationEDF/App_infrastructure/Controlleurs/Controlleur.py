import json
import logging
import os
import random
import re
import time
import uuid
from functools import wraps
from pathlib import Path

import bcrypt
from flask import Blueprint, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from utilisation_ou_non_mqtt_mysql import USE_MQTT, USE_MYSQL

if USE_MQTT:
	import paho.mqtt.client as mqtt

if USE_MYSQL:
	import mysql.connector


# ---------------------------------------------------------------------------
# Helpers partages
# ---------------------------------------------------------------------------
def ids_triees(values) -> list[int]:
	def cle_tri(identifier):
		text = str(identifier).strip()
		if text.isdigit():
			return (0, int(text))
		return (1, text)

	return sorted(values, key=cle_tri)


def nettoyer_donnees(payload: str) -> str:
	p = (payload or "").strip()
	return p.replace("Bq/m2", "").replace("Bq/cm2", "").replace("Bq", "").strip()


def valider_nom_appareil(name: str, device_type: str):
	n = (name or "").strip()
	t = (device_type or "").strip()
	if not n:
		return False, "Le nom est obligatoire."
	if not t:
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


def extraire_id_depuis_nom(name: str, prefix: str):
	ok, _ = valider_nom_appareil(name, prefix)
	if not ok:
		return None

	digits = "".join(ch for ch in str(name) if ch.isdigit())
	if not digits:
		return None
	try:
		return int(digits)
	except ValueError:
		return None


def appliquer_headers_no_cache(response):
	response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
	response.headers["Pragma"] = "no-cache"
	response.headers["Expires"] = "0"
	return response


MQTT_USERNAME = "client"
MQTT_PASSWORD = "normandie765"
BROKER_HOST = os.environ.get("BROKER_HOST", "127.0.0.1")
BROKER_PORT = int(os.environ.get("BROKER_PORT", "1883"))


def getenv_int(name: str, default: int) -> int:
	try:
		return int(os.environ.get(name, str(default)))
	except (TypeError, ValueError):
		return default


def configurer_demarrer_mqtt(client, on_connect, on_message):
	client.on_connect = on_connect
	client.on_message = on_message
	client.username_pw_set(os.environ.get("MQTT_USERNAME", MQTT_USERNAME), os.environ.get("MQTT_PASSWORD", MQTT_PASSWORD))
	client.reconnect_delay_set(min_delay=1, max_delay=30)
	try:
		client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
		client.loop_start()
	except Exception as exc:
		print("MQTT connect error:", exc)
	return client


def lire_id_formulaire(field_name: str = "id"):
	raw_value = request.form.get(field_name, "")
	try:
		return int(raw_value)
	except ValueError:
		return None


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
login_bp = Blueprint("login", __name__)

_LOCAL_USERS = [
	{"id": 1, "username": "admin", "password": "adminormandie765", "role": "admin"},
	{"id": 2, "username": "formateur", "password": "fnormandie765", "role": "user"},
]

MAX_LOGIN_ATTEMPTS = 5
LOCK_DURATION_SECONDS = 5

MYSQL_CONFIG = {
	"host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
	"user": os.environ.get("MYSQL_USER", "root"),
	"password": os.environ.get("MYSQL_PASSWORD", ""),
	"database": os.environ.get("MYSQL_DATABASE", "EDF"),
	"port": getenv_int("MYSQL_PORT", 3306),
}


def obtenir_secondes_verrou_restantes() -> int:
	lock_until = float(session.get("login_lock_until", 0) or 0)
	now = time.time()
	return max(0, int(lock_until - now))


def formater_temps_restant(seconds: int) -> str:
	minutes = seconds // 60
	remaining_seconds = seconds % 60
	if minutes <= 0:
		return f"{remaining_seconds} sec"
	return f"{minutes} min {remaining_seconds:02d} sec"


def message_erreur_verrou(remaining_seconds: int) -> str:
	return (
		"Trop de tentatives echouees. "
		f"Reessaie dans {formater_temps_restant(remaining_seconds)}."
	)


def message_identifiants_invalides(remaining_attempts: int) -> str:
	suffix = "tentative" if remaining_attempts == 1 else "tentatives"
	return (
		"Identifiant ou mot de passe incorrect, "
		f"il vous reste {remaining_attempts} {suffix}."
	)


def reinitialiser_tentatives_connexion() -> None:
	session.pop("login_attempts", None)
	session.pop("login_lock_until", None)


def normaliser_role(role: str) -> str:
	role_norm = str(role or "").strip().lower()
	if role_norm in {"admin", "administrateur"}:
		return "admin"
	return "user"


def normaliser_hash_bcrypt(stored_password) -> str:
	"""Normalize DB password representation to a bcrypt-compatible string."""
	if isinstance(stored_password, bytes):
		text = stored_password.decode("utf-8", errors="ignore")
	else:
		text = str(stored_password or "")

	text = text.strip()

	# Handle values stored like: b'$2b$...'
	if text.startswith("b'") and text.endswith("'"):
		text = text[2:-1]
	elif text.startswith('b"') and text.endswith('"'):
		text = text[2:-1]

	# PHP bcrypt hashes often use $2y$, Python bcrypt expects $2b$.
	if text.startswith("$2y$"):
		text = "$2b$" + text[4:]

	# Some rows are malformed and miss the bcrypt version, e.g. "$12$..."
	# Rebuild to a valid bcrypt prefix expected by python-bcrypt.
	if text.startswith("$12$"):
		text = "$2b$12$" + text[4:]

	return text


def verifier_mot_de_passe(password: str, stored_password) -> bool:
	stored = normaliser_hash_bcrypt(stored_password)
	if not stored:
		return False

	if stored.startswith("$2b$") or stored.startswith("$2a$"):
		try:
			return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
		except ValueError:
			return False

	# Legacy fallback for clear-text rows
	return stored == password


def enregistrer_tentative_echec() -> int:
	attempts = int(session.get("login_attempts", 0) or 0) + 1
	session["login_attempts"] = attempts

	if attempts >= MAX_LOGIN_ATTEMPTS:
		session["login_lock_until"] = time.time() + LOCK_DURATION_SECONDS

	return attempts


def authentifier_utilisateur(username: str, password: str) -> tuple:
	if not username or not password:
		return False, None

	if not USE_MYSQL:
		for user in _LOCAL_USERS:
			if user["username"] == username:
				if verifier_mot_de_passe(password, user.get("password", "")):
					return True, dict(user)
		return False, None

	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor(dictionary=True)
		query = "SELECT * FROM users WHERE LOWER(username) = LOWER(%s)"
		cursor.execute(query, (username,))
		user = cursor.fetchone()
		cursor.close()
		connection.close()

		if user is None:
			return False, None

		if verifier_mot_de_passe(password, user.get("password", "")):
			return True, user

		return False, None

	except Exception as err:
		print(f"Erreur MySQL: {err}")
		return False, None


@login_bp.route("/login", methods=["GET", "POST"])
def connexion():
	remaining = obtenir_secondes_verrou_restantes()

	if remaining == 0 and session.get("login_lock_until"):
		reinitialiser_tentatives_connexion()

	if request.method == "POST":
		remaining = obtenir_secondes_verrou_restantes()
		if remaining > 0:
			session["login_error"] = message_erreur_verrou(remaining)
			session["login_locked"] = True
			return redirect(url_for("login.connexion"))

		username = request.form.get("login", "").strip()
		password = request.form.get("password", "")

		if not username or not password:
			return redirect(url_for("login.connexion"))

		auth_success, user_data = authentifier_utilisateur(username, password)
		if auth_success:
			session["is_authenticated"] = True
			session["user_id"] = user_data.get("id")
			session["username"] = user_data.get("username")
			session["role"] = normaliser_role(user_data.get("role", "user"))
			reinitialiser_tentatives_connexion()
			session.pop("login_error", None)
			session.pop("login_locked", None)
			return redirect(url_for("accueil.accueil_page", just_logged="1"))

		enregistrer_tentative_echec()
		remaining = obtenir_secondes_verrou_restantes()
		session.pop("is_authenticated", None)
		if remaining > 0:
			session["login_error"] = message_erreur_verrou(remaining)
			session["login_locked"] = True
		else:
			remaining_attempts = max(0, MAX_LOGIN_ATTEMPTS - int(session.get("login_attempts", 0) or 0))
			session["login_error"] = message_identifiants_invalides(remaining_attempts)
			session["login_locked"] = False

		return redirect(url_for("login.connexion"))

	if session.get("is_authenticated"):
		return redirect(url_for("accueil.accueil_page"))

	error = session.pop("login_error", None)
	locked = session.pop("login_locked", False)

	remaining = obtenir_secondes_verrou_restantes()
	if remaining > 0:
		error = message_erreur_verrou(remaining)
		locked = True

	return render_template("login/login.html", error=error, locked=locked)


@login_bp.route("/logout")
def deconnexion():
	session.pop("is_authenticated", None)
	session.pop("role", None)
	return redirect(url_for("login.connexion"))


def is_admin():
	return session.get("role") == "admin"


def require_admin_role():
	def decorator(f):
		@wraps(f)
		def decorated_function(*args, **kwargs):
			if not session.get("is_authenticated") or not is_admin():
				return {"error": "Permission refusee"}, 403
			return f(*args, **kwargs)

		return decorated_function

	return decorator


# ---------------------------------------------------------------------------
# Accueil
# ---------------------------------------------------------------------------
accueil_bp = Blueprint("accueil", __name__)
INITIALISATEUR_DIR = Path(__file__).resolve().parents[2] / "App_initialisateur"


@accueil_bp.route("/")
def accueil():
	return redirect(url_for("accueil.accueil_page"))


@accueil_bp.route("/accueil")
def accueil_page():
	if not session.get("is_authenticated"):
		return redirect(url_for("login.connexion"))
	return render_template("accueil/accueil.html")


@accueil_bp.route("/menu")
def menu():
	return redirect(url_for("accueil.accueil_page"))


@accueil_bp.route("/initialisateur")
def initialisateur_root():
	return redirect(url_for("accueil.initialisateur_index"))


@accueil_bp.route("/initialisateur/")
@accueil_bp.route("/initialisateur/index.html")
def initialisateur_index():
	return send_from_directory(INITIALISATEUR_DIR, "index.html")


@accueil_bp.route("/initialisateur/<path:filename>")
def initialisateur_files(filename: str):
	return send_from_directory(INITIALISATEUR_DIR, filename)


# ---------------------------------------------------------------------------
# C2
# ---------------------------------------------------------------------------
c2_bp = Blueprint("c2", __name__, url_prefix="/C2")

TOPIC_C2_CAPTEURS_LEGACY = "FormaReaEDF/C2/+/Capteurs"
TOPIC_C2_CAPTEURS_FACE = "FormaReaEDF/C2/+/CapteursFace"
TOPIC_C2_CAPTEURS_DOS = "FormaReaEDF/C2/+/CapteursDos"
TOPIC_C2_GENRE = "FormaReaEDF/C2/+/Genre"

mqtt_client_c2 = None
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

	if text.startswith("$"):
		text = text[1:]
	if "," in text:
		text = text.split(",", 1)[0]

	values = []
	for token in re.findall(r"\d+", text):
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


def normaliser_genre(value, default="M"):
	text = str(value or "").strip().upper()
	if text in {"M", "H", "HOMME"}:
		return "M"
	if text in {"F", "FEMME"}:
		return "F"
	return default


def genre_ui(value):
	return "femme" if normaliser_genre(value) == "F" else "homme"


def genre_aleatoire():
	return random.choice(["M", "F"])


def garantir_genre_entry(entry):
	if not isinstance(entry, dict):
		entry = {"F": [], "D": []}

	entry.setdefault("F", [])
	entry.setdefault("D", [])
	entry["genre"] = normaliser_genre(entry.get("genre"), None) or genre_aleatoire()
	return entry


def entree_c2_defaut():
	return garantir_genre_entry({"F": [], "D": []})


def analyser_charge_capteurs(payload: str):
	text = (payload or "").strip()
	if not text:
		return [], []

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

	prefixed = re.match(r"(?i)^C2[\s_-]*(\d+)$", token)
	if prefixed:
		try:
			return int(prefixed.group(1))
		except ValueError:
			return None

	matches = re.findall(r"\d+", token)
	if not matches:
		return None
	try:
		return int(matches[-1])
	except ValueError:
		return None


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
	mqtt_client_c2 = mqtt.Client(client_id=f"IHM_C2_{uuid.uuid4().hex[:8]}")

	def connecter_mqtt_c2(client, userdata, flags, rc):
		try:
			client.subscribe(TOPIC_C2_CAPTEURS_LEGACY)
			client.subscribe(TOPIC_C2_CAPTEURS_FACE)
			client.subscribe(TOPIC_C2_CAPTEURS_DOS)
			client.subscribe(TOPIC_C2_GENRE)
			print(f"C2 MQTT connected (rc={rc}) and subscribed", flush=True)
		except Exception as exc:
			print("MQTT on_connect subscribe error:", exc)

	def traiter_message_mqtt_c2(client, userdata, msg):
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
			else:
				c2_values[c2_id] = garantir_genre_entry(c2_values[c2_id])

			if topic_suffix == "capteursface":
				c2_values[c2_id]["F"] = parser_liste_capteurs_texte(payload)
			elif topic_suffix == "capteursdos":
				c2_values[c2_id]["D"] = parser_liste_capteurs_texte(payload)
			elif topic_suffix == "genre":
				c2_values[c2_id]["genre"] = normaliser_genre(payload, c2_values[c2_id].get("genre", "M"))
			else:
				f_values, d_values = analyser_charge_capteurs(payload)
				c2_values[c2_id] = {
					"F": f_values,
					"D": d_values,
					"genre": c2_values[c2_id].get("genre", "M"),
				}

			if c2_id not in c2_names:
				c2_names[c2_id] = f"C2 ID {c2_id}"
		except Exception as exc:
			print("MQTT on_message error:", exc)

	mqtt_client_c2 = configurer_demarrer_mqtt(mqtt_client_c2, connecter_mqtt_c2, traiter_message_mqtt_c2)


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
	else:
		c2_values[c2_id] = garantir_genre_entry(c2_values[c2_id])

	return render_template(
		"c2/C2.html",
		c2_id=c2_id,
		c2_names=c2_names,
		c2_ids=sorted(c2_names.keys()),
		current_gender=genre_ui(c2_values[c2_id].get("genre", "M")),
		role=session.get("role", "user"),
	)


@c2_bp.route("/publish_capteurs_full", methods=["POST"])
def publier_capteurs_complet():
	raw_c2_id = request.form.get("c2_id") or request.values.get("c2_id")
	raw_f = request.form.get("F")
	raw_d = request.form.get("D")

	if raw_c2_id is None and request.is_json:
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

	raw_genre = request.form.get("genre") or request.values.get("genre")
	if raw_genre is None and request.is_json:
		data = request.get_json(silent=True) or {}
		raw_genre = data.get("genre")

	c2_token_input = str(raw_c2_id or "C2_1")
	c2_numeric_id = extraire_id_numerique_c2(c2_token_input)
	c2_token = f"C2_{c2_numeric_id}" if c2_numeric_id is not None and c2_numeric_id >= 1 else c2_token_input
	existing_entry = c2_values.get(c2_numeric_id) if c2_numeric_id is not None and c2_numeric_id >= 1 else None
	genre_code = normaliser_genre(raw_genre, garantir_genre_entry(existing_entry or {}).get("genre", genre_aleatoire()))

	if c2_numeric_id is not None and c2_numeric_id >= 1:
		c2_values[c2_numeric_id] = garantir_genre_entry({"F": f_list, "D": d_list, "genre": genre_code})
		if c2_numeric_id not in c2_names:
			c2_names[c2_numeric_id] = f"C2 ID {c2_numeric_id}"

	topic_face = f"FormaReaEDF/C2/{c2_token}/CapteursFace"
	topic_dos = f"FormaReaEDF/C2/{c2_token}/CapteursDos"
	topic_genre = f"FormaReaEDF/C2/{c2_token}/Genre"
	payload_face = formater_tableau(f_list)
	payload_dos = formater_tableau(d_list)
	payload_genre = genre_code

	if USE_MQTT and mqtt_client_c2:
		try:
			mqtt_client_c2.publish(topic_face, payload_face, qos=1, retain=True)
			mqtt_client_c2.publish(topic_dos, payload_dos, qos=1, retain=True)
			mqtt_client_c2.publish(topic_genre, payload_genre, qos=1, retain=True)
		except Exception as exc:
			print("MQTT publish error:", exc)
			return jsonify({"status": "error", "error": "mqtt_publish_failed"}), 500

	return jsonify(
		{
			"status": "ok",
			"topic_face": topic_face,
			"topic_dos": topic_dos,
			"topic_genre": topic_genre,
			"payload_face": payload_face,
			"payload_dos": payload_dos,
			"genre": payload_genre,
		}
	), 200


@c2_bp.route("/ajouter-appareil", methods=["POST"])
@require_admin_role()
def ajouter_appareil_c2():
	name = request.form.get("name", "")
	genre_code = normaliser_genre(request.form.get("gender"), None)
	device_type = "C2"

	ok, error = valider_nom_appareil(name, device_type)
	if not ok:
		return jsonify(ok=False, error=error), 400
	if genre_code is None:
		return jsonify(ok=False, error="Le genre est obligatoire."), 400

	c2_id = extraire_id_appareil(name, device_type)
	if c2_id is None:
		return jsonify(ok=False, error="Numero manquant dans le nom."), 400
	if c2_id > 99:
		return jsonify(ok=False, error="Maximum 2 chiffres (1 a 99)."), 400
	if c2_id < 1 or c2_id > 99:
		return jsonify(ok=False, error="ID C2 invalide (1 a 99)."), 400

	c2_names[c2_id] = f"C2 ID {c2_id}"
	entry = garantir_genre_entry(c2_values.get(c2_id, entree_c2_defaut()))
	entry["genre"] = genre_code
	c2_values[c2_id] = entry

	if USE_MQTT and mqtt_client_c2:
		try:
			mqtt_client_c2.publish(f"FormaReaEDF/C2/C2_{c2_id}/Genre", genre_code, qos=1, retain=True)
		except Exception as exc:
			print("MQTT publish error:", exc)
			return jsonify(ok=False, error="Publication MQTT impossible."), 500

	print(f"C2 No{c2_id} a ete cree")
	return jsonify(ok=True, genre=genre_code)


@c2_bp.route("/supprimer-appareil", methods=["POST"])
@require_admin_role()
def supprimer_appareil_c2():
	c2_id = lire_id_formulaire()
	if c2_id is None:
		return jsonify(ok=False, error="ID invalide."), 400

	if c2_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	c2_names.pop(c2_id, None)
	c2_values.pop(c2_id, None)

	print(f"C2 No{c2_id} a ete supprime")
	return jsonify(ok=True)


@c2_bp.route("/state/<int:c2_id>")
def obtenir_etat_c2(c2_id: int):
	if c2_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	entry = c2_values.get(c2_id)
	if entry is None:
		entry = entree_c2_defaut()
	else:
		entry = garantir_genre_entry(entry)
	c2_values[c2_id] = entry

	response = jsonify(
		ok=True,
		c2_id=f"C2_{c2_id}",
		F=normaliser_liste_numerique(entry.get("F", [])),
		D=normaliser_liste_numerique(entry.get("D", [])),
		genre=normaliser_genre(entry.get("genre", "M")),
	)
	return appliquer_headers_no_cache(response)


# ---------------------------------------------------------------------------
# CM
# ---------------------------------------------------------------------------
cm_bp = Blueprint("cm", __name__, url_prefix="/ControllerMobile")

TOPIC_CM_CONTAMINATION_WILDCARD = "FormaReaEDF/ControllerMobile/+/NivContamination"
TOPIC_CM_STATUS_WILDCARD = "FormaReaEDF/ControllerMobile/+/Status"


def entree_par_defaut_cm():
	return {"NivContamination": "1", "Status": "0"}


def topic_contamination_cm(cm_id: int) -> str:
	return f"FormaReaEDF/ControllerMobile/CM_{cm_id}/NivContamination"


def topic_status_cm(cm_id: int) -> str:
	return f"FormaReaEDF/ControllerMobile/CM_{cm_id}/Status"


last_values_cm = {i: entree_par_defaut_cm() for i in range(1, 12)}
cm_names = {i: f"CM ID {i}" for i in range(1, 12)}
deleted_cm_ids: set[int] = set()
mqtt_client_cm = None


def ids_cm_actifs() -> list[int]:
	return ids_triees(i for i in cm_names.keys() if i not in deleted_cm_ids)


def initialiser_mqtt_cm(cm_id: int):
	if not (USE_MQTT and mqtt_client_cm):
		return

	last_values_cm[cm_id].setdefault("Status", "0")
	mqtt_client_cm.publish(topic_contamination_cm(cm_id), f"{last_values_cm[cm_id]['NivContamination']}", retain=True)
	mqtt_client_cm.publish(topic_status_cm(cm_id), f"{last_values_cm[cm_id]['Status']}", retain=True)


def deconnecter_mqtt_cm(cm_id: int):
	if not (USE_MQTT and mqtt_client_cm):
		return

	mqtt_client_cm.publish(topic_contamination_cm(cm_id), "", retain=True)
	mqtt_client_cm.publish(topic_status_cm(cm_id), "", retain=True)


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

	for cm_id in list(last_values_cm.keys()):
		if cm_id not in deleted_cm_ids:
			initialiser_mqtt_cm(cm_id)


def traiter_message_mqtt_cm(client, userdata, msg):
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

		if cm_id < 1 or cm_id in deleted_cm_ids or cm_id not in cm_names:
			return

		if cm_id not in last_values_cm:
			last_values_cm[cm_id] = entree_par_defaut_cm()

		if "NivContamination" in msg.topic:
			last_values_cm[cm_id]["NivContamination"] = payload
		elif msg.topic.lower().endswith("/status"):
			last_values_cm[cm_id]["Status"] = "1" if str(payload).strip() == "1" else "0"

	except Exception as exc:
		print("MQTT on_message error:", exc)


if USE_MQTT:
	mqtt_client_cm = mqtt.Client(client_id="IHM_ControllerMobile", protocol=mqtt.MQTTv311)
	mqtt_client_cm = configurer_demarrer_mqtt(mqtt_client_cm, on_connect_mqtt_cm, traiter_message_mqtt_cm)


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

	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()
	if cm_id not in cm_names:
		cm_names[cm_id] = f"CM ID {cm_id}"
	last_values_cm[cm_id].setdefault("Status", "0")

	return render_template(
		"cm/CM.html",
		cm_id=cm_id,
		valeur_conta=last_values_cm[cm_id]["NivContamination"],
		cm_names=cm_names,
		cm_ids=ids_cm_actifs(),
		role=session.get("role", "user"),
	)


@cm_bp.route("/slider/<int:cm_id>", methods=["POST"])
def slider_cm(cm_id: int):
	if cm_id < 1:
		return "unknown cm_id", 400

	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()
	last_values_cm[cm_id].setdefault("Status", "0")

	value = request.form.get("value")
	type_ = request.form.get("type")
	equip = request.form.get("equip")

	if value is None:
		return "missing value", 400

	type_norm = (type_ or "").strip().lower()
	if type_norm in ("status", "statut"):
		normalized_status = "1" if str(value).strip() == "1" else "0"
		last_values_cm[cm_id]["Status"] = normalized_status
		topic = topic_status_cm(cm_id)
		display_type = "Status"
		value_to_publish = normalized_status
	else:
		last_values_cm[cm_id]["NivContamination"] = value
		topic = topic_contamination_cm(cm_id)
		display_type = "Contamination"
		value_to_publish = value

	print(equip, display_type, "=", value_to_publish, "", flush=True)

	if USE_MQTT and mqtt_client_cm:
		mqtt_client_cm.publish(topic, f"{value_to_publish}", retain=True)

	return "ok"


@cm_bp.route("/ajouter-appareil", methods=["POST"], endpoint="ajouter_appareil")
@require_admin_role()
def ajouter_appareil_cm():
	name = request.form.get("name", "")
	device_type = request.form.get("type", "")

	ok, error = valider_nom_appareil(name, device_type)
	if not ok:
		return jsonify(ok=False, error=error), 400

	cm_id = extraire_id_depuis_nom(name, "CM")
	if cm_id is None:
		return jsonify(ok=False, error="Numero manquant dans le nom."), 400
	if cm_id > 99:
		return jsonify(ok=False, error="Maximum 2 chiffres (1 a 99)."), 400
	if cm_id < 1:
		return jsonify(ok=False, error="ID CM invalide (1 a 99)."), 400

	cm_names[cm_id] = f"CM ID {cm_id}"
	deleted_cm_ids.discard(cm_id)
	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()
	initialiser_mqtt_cm(cm_id)

	print(f"Controller Mobile No{cm_id} a ete cree")
	return jsonify(ok=True)


@cm_bp.route("/supprimer-appareil", methods=["POST"], endpoint="supprimer_appareil")
@require_admin_role()
def supprimer_appareil_cm():
	cm_id = lire_id_formulaire()
	if cm_id is None:
		return jsonify(ok=False, error="ID invalide."), 400

	if cm_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	deleted_cm_ids.add(cm_id)
	cm_names.pop(cm_id, None)
	last_values_cm.pop(cm_id, None)
	deconnecter_mqtt_cm(cm_id)

	print(f"Controller Mobile No{cm_id} a ete supprime")
	return jsonify(ok=True)


@cm_bp.route("/state/<int:cm_id>", endpoint="obtenir_etat")
def obtenir_etat_cm(cm_id: int):
	if cm_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()

	entry = last_values_cm[cm_id]
	contamination = str(entry.get("NivContamination", "1"))
	status = "1" if str(entry.get("Status", "0")).strip() == "1" else "0"

	response = jsonify(ok=True, cm_id=cm_id, NivContamination=contamination, Status=status)
	return appliquer_headers_no_cache(response)


# ---------------------------------------------------------------------------
# CPO
# ---------------------------------------------------------------------------
cpo_bp = Blueprint("cpo", __name__, url_prefix="/CPO")

TOPIC_CPO_CONTAMINATION_WILDCARD = "FormaReaEDF/CPO/+/NivContamination"


def entree_par_defaut_cpo():
	return {"NivContamination": "1"}


def topic_contamination_cpo(cpo_id: int) -> str:
	return f"FormaReaEDF/CPO/CPO_{cpo_id}/NivContamination"


last_values_cpo = {i: entree_par_defaut_cpo() for i in range(1, 5)}
cpo_names = {i: f"CPO ID {i}" for i in range(1, 5)}
deleted_cpo_ids: set[int] = set()
mqtt_client_cpo = None


def ids_cpo_actifs() -> list[int]:
	return ids_triees(i for i in cpo_names.keys() if i not in deleted_cpo_ids)


def initialiser_mqtt_cpo(cpo_id: int):
	if not (USE_MQTT and mqtt_client_cpo):
		return

	mqtt_client_cpo.publish(topic_contamination_cpo(cpo_id), f"{last_values_cpo[cpo_id]['NivContamination']}", retain=True)


def deconnecter_mqtt_cpo(cpo_id: int):
	if not (USE_MQTT and mqtt_client_cpo):
		return

	mqtt_client_cpo.publish(topic_contamination_cpo(cpo_id), "", retain=True)


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

	for cpo_id in list(last_values_cpo.keys()):
		if cpo_id not in deleted_cpo_ids:
			initialiser_mqtt_cpo(cpo_id)


def traiter_message_mqtt_cpo(client, userdata, msg):
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

		if cpo_id < 1 or cpo_id in deleted_cpo_ids or cpo_id not in cpo_names:
			return

		if cpo_id not in last_values_cpo:
			last_values_cpo[cpo_id] = entree_par_defaut_cpo()

		if msg.topic.lower().endswith("/nivcontamination"):
			last_values_cpo[cpo_id]["NivContamination"] = payload

	except Exception as exc:
		print("MQTT on_message error:", exc)


if USE_MQTT:
	mqtt_client_cpo = mqtt.Client(client_id="IHM_CPO", protocol=mqtt.MQTTv311)
	mqtt_client_cpo = configurer_demarrer_mqtt(mqtt_client_cpo, on_connect_mqtt_cpo, traiter_message_mqtt_cpo)


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

	if cpo_id not in last_values_cpo:
		last_values_cpo[cpo_id] = entree_par_defaut_cpo()
	if cpo_id not in cpo_names:
		cpo_names[cpo_id] = f"CPO ID {cpo_id}"

	return render_template(
		"cpo/CPO.html",
		cpo_id=cpo_id,
		valeur_conta=last_values_cpo[cpo_id]["NivContamination"],
		cpo_names=cpo_names,
		cpo_ids=ids_cpo_actifs(),
		role=session.get("role", "user"),
	)


@cpo_bp.route("/slider/<int:cpo_id>", methods=["POST"], endpoint="traiter_jauge")
def traiter_jauge_cpo(cpo_id: int):
	if cpo_id < 1:
		return "unknown cpo_id", 400

	if cpo_id not in last_values_cpo:
		last_values_cpo[cpo_id] = entree_par_defaut_cpo()

	value = request.form.get("value")
	equip = request.form.get("equip")

	if value is None:
		return "missing value", 400

	last_values_cpo[cpo_id]["NivContamination"] = value
	print(equip, "Contamination", "=", value, "", flush=True)

	if USE_MQTT and mqtt_client_cpo:
		mqtt_client_cpo.publish(topic_contamination_cpo(cpo_id), f"{value}", retain=True)

	return "ok"


@cpo_bp.route("/ajouter-appareil", methods=["POST"], endpoint="ajouter_appareil")
@require_admin_role()
def ajouter_appareil_cpo():
	name = request.form.get("name", "")
	device_type = request.form.get("type", "")

	ok, error = valider_nom_appareil(name, device_type)
	if not ok:
		return jsonify(ok=False, error=error), 400

	cpo_id = extraire_id_depuis_nom(name, "CPO")
	if cpo_id is None:
		return jsonify(ok=False, error="Il manque le numero du nouvel appareil"), 400
	if cpo_id > 99:
		return jsonify(ok=False, error="Maximum 2 chiffres (1 a 99)."), 400
	if cpo_id < 1:
		return jsonify(ok=False, error="ID CPO invalide (1 a 99)."), 400

	cpo_names[cpo_id] = f"CPO ID {cpo_id}"
	deleted_cpo_ids.discard(cpo_id)
	if cpo_id not in last_values_cpo:
		last_values_cpo[cpo_id] = entree_par_defaut_cpo()
	initialiser_mqtt_cpo(cpo_id)

	print(f"CPO ID {cpo_id} a ete cree")
	return jsonify(ok=True)


@cpo_bp.route("/supprimer-appareil", methods=["POST"], endpoint="supprimer_appareil")
@require_admin_role()
def supprimer_appareil_cpo():
	cpo_id = lire_id_formulaire()
	if cpo_id is None:
		return jsonify(ok=False, error="ID invalide."), 400

	if cpo_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	deleted_cpo_ids.add(cpo_id)
	cpo_names.pop(cpo_id, None)
	last_values_cpo.pop(cpo_id, None)
	deconnecter_mqtt_cpo(cpo_id)

	print(f"CPO ID {cpo_id} a ete supprime")
	return jsonify(ok=True)


@cpo_bp.route("/state/<int:cpo_id>", endpoint="obtenir_etat")
def obtenir_etat_cpo(cpo_id: int):
	if cpo_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	if cpo_id not in last_values_cpo:
		last_values_cpo[cpo_id] = entree_par_defaut_cpo()

	entry = last_values_cpo[cpo_id]
	contamination = str(entry.get("NivContamination", "1"))

	response = jsonify(ok=True, cpo_id=cpo_id, NivContamination=contamination)
	return appliquer_headers_no_cache(response)


logging.getLogger("werkzeug").setLevel(logging.ERROR)
