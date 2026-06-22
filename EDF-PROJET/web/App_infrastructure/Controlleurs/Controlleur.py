# Module principal des routes Flask, MQTT et MySQL.
# Contient la logique de connexion, d'accueil, de réglages et des pages C2/CM/CPO.

import json
import logging
import os
import random
import re
import secrets
import time
import uuid
from functools import wraps
from pathlib import Path

import bcrypt
from flask import Blueprint, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from utilisation_ou_non_mqtt_mysql import USE_MQTT, USE_MYSQL

# Le module principal de contrôleurs Flask et de gestion MQTT/MySQL.
# Il expose les blueprints login, accueil, C2, CM, CPO et réglages.
# Le mode MQTT et MySQL sont activés/désactivés avec les flags dans utilisation_ou_non_mqtt_mysql.py.

if USE_MQTT:
    import paho.mqtt.client as mqtt

if USE_MYSQL:
    import mysql.connector


# ---------------------------------------------------------------------------
# Helpers partages
# ---------------------------------------------------------------------------
def ids_triees(values) -> list[int]:  # Trie une collection d'identifiants en mettant les entiers en premier (ordre croissant),
	#
	# Trie une collection d'identifiants en mettant les entiers en premier (ordre croissant),
	# puis les non-numériques en ordre alphabétique. Donne une liste d'entiers.
	#
	# Fonction interne pour trier les nombres avant les textes.
	def cle_tri(identifier):  # Retourne une clé de tri pour un identifiant
		# Retourne une clé de tri pour un identifiant.
		text = str(identifier).strip()
		if text.isdigit():
			return (0, int(text))
		return (1, text)

	return sorted(values, key=cle_tri)


def nettoyer_donnees(payload: str) -> str:  # Supprime les unités de mesure radioactive (Bq, Bq/cm2, Bq/m2) d'un payload MQTT
	#
	# Supprime les unités de mesure radioactive (Bq, Bq/cm2, Bq/m2) d'un payload MQTT
	# pour obtenir uniquement la valeur numérique brute.
	#
	p = (payload or "").strip()
	return p.replace("Bq/m2", "").replace("Bq/cm2", "").replace("Bq", "").strip()


def valider_nom_appareil(name: str, device_type: str):  # Vérifie qu'un nom d'appareil est valide : non vide et commence par le préfixe
	#
	# Vérifie qu'un nom d'appareil est valide : non vide et commence par le préfixe
	# du type (ex. "C2", "CM", "CPO"). Donne (True, "") ou (False, message_erreur).
	#
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


def extraire_id_depuis_nom(name: str, prefix: str):  # Extrait l'identifiant numérique depuis un nom d'appareil (ex. "C2 3" → 3)
	#
	# Extrait l'identifiant numérique depuis un nom d'appareil (ex. "C2 3" → 3).
	# Donne None si le nom est invalide ou ne contient pas de chiffres.
	#
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


def appliquer_headers_no_cache(response):  # Ajoute les headers HTTP no-cache à une réponse Flask pour éviter que le navigateur
	#
	# Ajoute les headers HTTP no-cache à une réponse Flask pour éviter que le navigateur
	# ou un proxy mette en cache les données d'état temps réel (polling).
	#
	response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
	response.headers["Pragma"] = "no-cache"
	response.headers["Expires"] = "0"
	return response


MQTT_USERNAME = "client"
MQTT_PASSWORD = "normandie765"
# Adresse du broker MQTT.
BROKER_HOST = os.environ.get("BROKER_HOST", "127.0.0.1")
# Port du broker MQTT.
BROKER_PORT = int(os.environ.get("BROKER_PORT", "1883"))

# Nombre maximum d'appareils pour CM, CPO et C2.
MAX_REGLAGE_CM = 16
MAX_REGLAGE_CPO = 6
MAX_REGLAGE_C2 = 6


def getenv_int(name: str, default: int) -> int:  # Lit une variable d'environnement et la convertit en entier
	#
	# Lit une variable d'environnement et la convertit en entier.
	# Donne default si la variable est absente ou non convertible.
	#
	try:
		return int(os.environ.get(name, str(default)))
	except (TypeError, ValueError):
		return default


def configurer_demarrer_mqtt(client, on_connect, on_message):  # Prépare le client MQTT pour fonctionner avec le broker
	#
	# Prépare le client MQTT pour fonctionner avec le broker.
	# Il utilise la connexion, la remise en marche et le message MQTT.
	#
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


def lire_id_formulaire(field_name: str = "id"):  # Lit un champ de formulaire HTTP et le convertit en entier
	#
	# Lit un champ de formulaire HTTP et le convertit en entier.
	# Donne None si le champ est absent ou non numérique.
	#
	raw_value = request.form.get(field_name, "")
	try:
		return int(raw_value)
	except ValueError:
		return None


def lire_reglages_mysql(ids: tuple[int, ...]) -> dict[int, str]:  # Lit plusieurs réglages depuis la table MySQL `reglage` par leurs IDs
	#
	# Lit plusieurs réglages depuis la table MySQL `reglage` par leurs IDs.
	# Donne un dict {id: valeur} (str). Donne {} si MySQL est désactivé.
	# IDs connus : 1 = nom de l'app, 2 = nb max CM, 3 = nb max CPO, 4 = nb max C2.
	#
	if not USE_MYSQL:
		return {}

	clean_ids = tuple(int(i) for i in ids if int(i) > 0)
	if not clean_ids:
		return {}

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor(dictionary=True)
		placeholders = ", ".join(["%s"] * len(clean_ids))
		cursor.execute(
			f"SELECT `id`, `valeur` FROM `reglage` WHERE `id` IN ({placeholders})",
			clean_ids,
		)
		rows = cursor.fetchall() or []
		result = {}
		for row in rows:
			try:
				reg_id = int(row.get("id"))
			except (TypeError, ValueError):
				continue
			result[reg_id] = str(row.get("valeur") or "")
		return result
	except Exception as err:
		print("MySQL reglage read error:", err)
		return {}
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def enregistrer_reglages_mysql(reglages: list[tuple[int, str, str]]) -> tuple[bool, str | None]:  # Ecrit des réglages dans la table MySQL `reglage`
	#
	# Ecrit des réglages dans la table MySQL `reglage`.
	# Chaque ligne est un tuple (id, type, valeur).
	# Si la ligne existe déjà, elle est mise à jour.
	# Si elle n'existe pas, elle est ajoutée.
	#
	if not USE_MYSQL:
		return False, "MySQL desactive"

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor()

		# On garde strictement 4 lignes de reglages (id 1..4).
		cursor.execute("DELETE FROM `reglage` WHERE `id` NOT IN (1, 2, 3, 4)")

		for reglage_id, reglage_type, reglage_valeur in reglages:
			cursor.execute(
				"INSERT INTO `reglage` (`id`, `type`, `valeur`) VALUES (%s, %s, %s) "
				"ON DUPLICATE KEY UPDATE `type` = VALUES(`type`), `valeur` = VALUES(`valeur`)",
				(int(reglage_id), str(reglage_type), str(reglage_valeur)),
			)

		connection.commit()
		return True, None
	except Exception as err:
		if connection is not None:
			connection.rollback()
		return False, str(err)
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
login_bp = Blueprint("login", __name__)

# Nombre de tentatives de connexion autorisées avant verrouillage temporaire.
MAX_LOGIN_ATTEMPTS = 5
# Durée du verrouillage en secondes après trop de tentatives échouées.
# 5 minutes = 300 secondes.
LOCK_DURATION_SECONDS = 5 * 60

# Configuration MySQL par défaut. Ces valeurs peuvent être modifiées avec des
# variables d'environnement ou directement dans le script si nécessaire.
MYSQL_CONFIG = {
	"host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
	"user": os.environ.get("MYSQL_USER", "root"),
	"password": os.environ.get("MYSQL_PASSWORD", ""),
	"database": os.environ.get("MYSQL_DATABASE", "EDF"),
	"port": getenv_int("MYSQL_PORT", 3306),
	# use_pure = True évite l'utilisation de l'extension C native sous accès concurrent.
	"use_pure": True,
}


def lire_limite_reglage_mysql(reglage_id: int, default_limit: int) -> int:  # Lit une valeur de réglage dans MySQL et la donne en nombre
	#
	# Lit une valeur de réglage dans MySQL et la donne en nombre.
	# C'est utilisé pour le nombre maximum d'appareils CM, CPO ou C2.
	# Si la valeur est absente ou mauvaise, on garde default_limit.
	#
	if not USE_MYSQL:
		return default_limit

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor(dictionary=True)
		cursor.execute("SELECT `valeur` FROM `reglage` WHERE `id` = %s LIMIT 1", (int(reglage_id),))
		row = cursor.fetchone() or {}
		raw = str(row.get("valeur", "")).strip()
		if not raw:
			return default_limit
		try:
			limit = int(float(raw))
		except (TypeError, ValueError):
			return default_limit
		return limit if limit > 0 else default_limit
	except Exception as err:
		print("MySQL reglage read error:", err)
		return default_limit
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def lire_equipements_mysql(types: tuple[str, ...]) -> tuple:  # Lit les équipements dans MySQL pour les types demandés
	#
	# Lit les équipements dans MySQL pour les types demandés.
	# Par exemple C2 ou CM.
	# Donne deux dictionnaires : {id: nom} et {id: genre}.
	#
	if not USE_MYSQL:
		return {}, {}

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor(dictionary=True)
		cursor.execute("SHOW COLUMNS FROM equipements")
		columns_info = cursor.fetchall()
		columns_map = {str(col.get("Field", "")).strip().lower(): str(col.get("Field", "")).strip() for col in columns_info}

		nom_col = columns_map.get("nom")
		type_col = columns_map.get("type")
		id_col = columns_map.get("groupe_id") or columns_map.get("group_id") or columns_map.get("id")
		genre_col = columns_map.get("genre")

		if not nom_col or not type_col or not id_col:
			return {}, {}

		types_values = tuple(str(t).strip() for t in types if str(t).strip())
		if not types_values:
			return {}, {}

		placeholders = ", ".join(["%s"] * len(types_values))
		select_cols = [f"`{nom_col}` AS nom", f"`{type_col}` AS type_name", f"`{id_col}` AS equip_id"]
		if genre_col:
			select_cols.append(f"`{genre_col}` AS genre")

		sql = (
			f"SELECT {', '.join(select_cols)} FROM `equipements` "
			f"WHERE LOWER(`{type_col}`) IN ({placeholders})"
		)
		cursor.execute(sql, tuple(v.lower() for v in types_values))
		rows = cursor.fetchall() or []

		names = {}
		genres = {}
		for row in rows:
			try:
				equip_id = int(row.get("equip_id"))
			except (TypeError, ValueError):
				continue
			if equip_id < 1:
				continue

			names[equip_id] = str(row.get("nom") or "").strip() or f"{row.get('type_name', 'Equipement')} ID {equip_id}"
			if "genre" in row:
				genres[equip_id] = normaliser_genre(row.get("genre"), None)

		return names, genres
	except Exception as err:
		print("MySQL equipements read error:", err)
		return {}, {}
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def supprimer_equipement_mysql(equip_id: int, equip_type: str) -> tuple:  # Supprime un équipement de la table MySQL `equipements` par son ID et son type
	#
	# Supprime un équipement de la table MySQL `equipements` par son ID et son type.
	# Accepte un type unique (str) ou plusieurs types (list/tuple) pour gérer les alias
	# (ex. MIP10/CM/CONTROLLERMOBILE). Donne (True, None) ou (False, message_erreur).
	#
	if not USE_MYSQL:
		return True, None

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor()
		cursor.execute("SHOW COLUMNS FROM equipements")
		columns_info = cursor.fetchall()
		columns_map = {str(col[0]).strip().lower(): str(col[0]).strip() for col in columns_info}

		type_col = columns_map.get("type")
		id_col = columns_map.get("groupe_id") or columns_map.get("group_id") or columns_map.get("id")
		if not type_col or not id_col:
			return False, "Colonnes type/id manquantes dans equipements"

		if isinstance(equip_type, (list, tuple, set)):
			types_values = [str(t).strip() for t in equip_type if str(t).strip()]
		else:
			types_values = [str(equip_type or "").strip()]

		if not types_values:
			return False, "Type equipement manquant"

		placeholders = ", ".join(["%s"] * len(types_values))
		sql = (
			f"DELETE FROM `equipements` "
			f"WHERE LOWER(`{type_col}`) IN ({placeholders}) AND `{id_col}` = %s"
		)
		params = tuple(v.lower() for v in types_values) + (int(equip_id),)
		cursor.execute(sql, params)
		connection.commit()
		return True, None
	except Exception as err:
		return False, str(err)
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def lire_utilisateurs_mysql() -> list[dict]:  # Lit tous les utilisateurs depuis la table MySQL `users`
	#
	# Lit tous les utilisateurs depuis la table MySQL `users`.
	# Donne une liste de dicts {id, username, role} triés par ID croissant.
	# Réutilisé par la page Réglages pour afficher la liste de gestion des comptes.
	#
	if not USE_MYSQL:
		return []

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor(dictionary=True)
		cursor.execute("SELECT id, username, role FROM users ORDER BY id ASC")
		rows = cursor.fetchall() or []
		users = []
		for row in rows:
			try:
				user_id = int(row.get("id", 0) or 0)
			except (TypeError, ValueError):
				continue
			users.append({
				"id": user_id,
				"username": str(row.get("username", "") or "").strip(),
				"role": normaliser_role(row.get("role", "user")),
			})
		return users
	except Exception as err:
		print("MySQL users read error:", err)
		return []
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def ajouter_utilisateur_mysql(username: str, password: str, role: str = "user") -> tuple:  # Crée un utilisateur dans MySQL avec le mot de passe hashé en bcrypt
	#
	# Crée un utilisateur dans MySQL avec le mot de passe hashé en bcrypt.
	# Normalise le rôle en "administrateur" ou "utilisateur".
	# Donne (True, None) ou (False, message_erreur). Gère les doublons de nom.
	#
	if not USE_MYSQL:
		return False, "MySQL désactivé"

	username = str(username or "").strip()
	role = str(role or "").strip().lower()
	if not username or not password:
		return False, "Nom d'utilisateur et mot de passe requis"

	if role in {"admin", "administrateur"}:
		db_role = "administrateur"
	else:
		db_role = "utilisateur"

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor()
		cursor.execute("SELECT COUNT(*) FROM `users`")
		total_users = cursor.fetchone()[0] or 0
		if total_users >= 10:
			return False, "erreur vous pouvez ajouter au maximum 10 utilisateurs"

		if db_role == "administrateur":
			cursor.execute("SELECT COUNT(*) FROM `users` WHERE `role` = 'administrateur'")
			admin_users = cursor.fetchone()[0] or 0
			if admin_users >= 10:
				return False, "erreur vous pouvez ajouter au maximum 10 utilisateurs"

		hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
		cursor.execute(
			"INSERT INTO `users` (`username`, `password`, `role`) VALUES (%s, %s, %s)",
			(username, hashed, db_role),
		)
		connection.commit()
		return True, None
	except mysql.connector.IntegrityError as err:
		message = str(err)
		if "Duplicate" in message or "duplicate" in message:
			return False, "Ce nom d'utilisateur existe déjà."
		return False, message
	except Exception as err:
		return False, str(err)
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def supprimer_utilisateur_mysql(user_id: int) -> tuple:  # Supprime un utilisateur de la table MySQL `users` par son ID
	#
	# Supprime un utilisateur de la table MySQL `users` par son ID.
	# Donne (True, None) ou (False, message_erreur).
	#
	if not USE_MYSQL:
		return True, None

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor()
		cursor.execute("DELETE FROM `users` WHERE `id` = %s", (int(user_id),))
		connection.commit()
		return True, None
	except Exception as err:
		return False, str(err)
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def verifier_mot_de_passe_utilisateur_mysql(user_id: int, password: str) -> bool:  # Vérifie le mot de passe d'un utilisateur directement par son ID MySQL
	#
	# Vérifie le mot de passe d'un utilisateur directement par son ID MySQL.
	# Récupère le hash bcrypt en base et le compare via verifier_mot_de_passe().
	# Donne False si MySQL est désactivé, si l'utilisateur n'existe pas ou si le mdp est faux.
	#
	if not USE_MYSQL or not password:
		return False

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor(dictionary=True)
		cursor.execute("SELECT password FROM `users` WHERE `id` = %s", (int(user_id),))
		row = cursor.fetchone()
		return bool(row and verifier_mot_de_passe(password, row.get("password", "")))
	except Exception:
		return False
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def normaliser_genre_mysql(value):  # Normalise une valeur de genre pour l'écriture en base MySQL
	#
	# Normalise une valeur de genre pour l'écriture en base MySQL.
	# Donne "femme", "homme", ou None si la valeur est inconnue.
	#
	text = str(value or "").strip().lower()
	if text in {"f", "femme"}:
		return "femme"
	if text in {"m", "h", "homme"}:
		return "homme"
	return None


def composer_id_equipement_mysql(equip_type: str, equip_id: int) -> int:  # Calcule un ID MySQL unique en ajoutant l'ID de l'équipement à une base par type :
	#
	# Calcule un ID MySQL unique en ajoutant l'ID de l'équipement à une base par type :
	# C2 → 1000+id, CPO → 2000+id, MIP10 → 3000+id, autre → 9000+id.
	# Pour éviter les collisions d'ID entre types différents dans la table.
	#
	type_norm = str(equip_type or "").strip().upper()
	try:
		numeric_id = int(equip_id)
	except (TypeError, ValueError):
		numeric_id = 0

	prefixes = {
		"C2": 1000,
		"CPO": 2000,
		"CM": 3000,
	}
	base = prefixes.get(type_norm, 9000)
	return base + max(0, numeric_id)


def enregistrer_equipement_mysql(equip_id: int, nom: str, equip_type: str, genre=None) -> tuple:  # Insert ou met à jour un équipement dans la table MySQL `equipements` (upsert manuel)
	#
	# Insert ou met à jour un équipement dans la table MySQL `equipements` (upsert manuel).
	# Gère dynamiquement les colonnes présentes (nom, type, genre, groupe_id/group_id).
	# Si l'équipement existe déjà, met à jour ; sinon, insère une nouvelle ligne.
	# Donne (True, None) ou (False, message_erreur).
	#
	if not USE_MYSQL:
		return True, None

	connection = None
	cursor = None
	try:
		connection = mysql.connector.connect(**MYSQL_CONFIG)
		cursor = connection.cursor()
		cursor.execute("SHOW COLUMNS FROM equipements")
		columns_info = cursor.fetchall()
		columns_map = {str(col[0]).strip().lower(): str(col[0]).strip() for col in columns_info}
		id_col_info = next((col for col in columns_info if str(col[0]).strip().lower() == "id"), None)

		for required in ("id", "nom", "type"):
			if required not in columns_map:
				return False, f"Colonne manquante dans equipements: {required}"

		nom_value = str(nom or "").strip()
		type_value = str(equip_type or "").strip()
		genre_value = normaliser_genre_mysql(genre)
		groupe_col = columns_map.get("groupe_id") or columns_map.get("group_id")

		if groupe_col:
			cursor.execute(
				f"SELECT `{columns_map['id']}` FROM `equipements` WHERE LOWER(`{columns_map['type']}`) = LOWER(%s) AND `{groupe_col}` = %s LIMIT 1",
				(type_value, int(equip_id)),
			)
		else:
			cursor.execute(
				f"SELECT `{columns_map['id']}` FROM `equipements` WHERE LOWER(`{columns_map['type']}`) = LOWER(%s) AND LOWER(`{columns_map['nom']}`) = LOWER(%s) LIMIT 1",
				(type_value, nom_value),
			)
		existing = cursor.fetchone()

		if existing:
			update_parts = [f"`{columns_map['nom']}` = %s", f"`{columns_map['type']}` = %s"]
			update_values = [nom_value, type_value]
			if "genre" in columns_map:
				update_parts.append(f"`{columns_map['genre']}` = %s")
				update_values.append(genre_value)
			if groupe_col:
				update_parts.append(f"`{groupe_col}` = %s")
				update_values.append(int(equip_id))

			update_values.append(existing[0])
			cursor.execute(
				f"UPDATE `equipements` SET {', '.join(update_parts)} WHERE `{columns_map['id']}` = %s",
				tuple(update_values),
			)
			connection.commit()
			return True, None

		insert_cols = [columns_map["nom"], columns_map["type"]]
		insert_values = [nom_value, type_value]

		if "genre" in columns_map:
			insert_cols.append(columns_map["genre"])
			insert_values.append(genre_value)
		if groupe_col:
			insert_cols.append(groupe_col)
			insert_values.append(int(equip_id))

		if id_col_info is not None:
			id_null = str(id_col_info[2]).strip().upper() == "YES"
			id_default = id_col_info[4]
			id_extra = str(id_col_info[5] or "").strip().lower()
			id_is_auto = "auto_increment" in id_extra

			if not id_is_auto and not id_null and id_default is None:
				cursor.execute(f"SELECT COALESCE(MAX(`{columns_map['id']}`), 0) + 1 FROM `equipements`")
				next_id_row = cursor.fetchone()
				next_id = int(next_id_row[0]) if next_id_row and next_id_row[0] is not None else 1
				insert_cols.insert(0, columns_map["id"])
				insert_values.insert(0, next_id)

		cols_sql = ", ".join([f"`{c}`" for c in insert_cols])
		placeholders = ", ".join(["%s"] * len(insert_values))

		sql = f"INSERT INTO `equipements` ({cols_sql}) VALUES ({placeholders})"
		cursor.execute(sql, tuple(insert_values))
		connection.commit()
		return True, None
	except Exception as err:
		return False, str(err)
	finally:
		if cursor is not None:
			cursor.close()
		if connection is not None:
			connection.close()


def obtenir_secondes_verrou_restantes() -> int:  # Donne le nombre de secondes restantes avant la fin du blocage anti-brute-force
	#
	# Donne le nombre de secondes restantes avant la fin du blocage anti-brute-force.
	# Lit login_lock_until depuis la session Flask. Donne 0 si le verrou est expiré.
	#
	lock_until = float(session.get("login_lock_until", 0) or 0)
	now = time.time()
	return max(0, int(lock_until - now))


def formater_temps_restant(seconds: int) -> str:  # Formate un nombre de secondes en chaîne lisible : "X sec" ou "X min YY sec"
	#
	# Formate un nombre de secondes en chaîne lisible : "X sec" ou "X min YY sec".
	# Pour afficher le temps de blocage restant dans les messages d'erreur.
	#
	minutes = seconds // 60
	remaining_seconds = seconds % 60
	if minutes <= 0:
		return f"{remaining_seconds} sec"
	return f"{minutes} min {remaining_seconds:02d} sec"


def message_erreur_verrou(remaining_seconds: int) -> str:  # Construit le message d'erreur affiché quand le compte est temporairement bloqué
	#
	# Construit le message d'erreur affiché quand le compte est temporairement bloqué
	# apres trop de tentatives échouées. Inclut le temps restant formaté.
	#
	return (
		"Trop de tentatives echouees. "
		f"Reessaie dans {formater_temps_restant(remaining_seconds)}."
	)


def message_identifiants_invalides(remaining_attempts: int) -> str:  # Construit le message d'erreur affiché quand les identifiants sont incorrects
	#
	# Construit le message d'erreur affiché quand les identifiants sont incorrects.
	# Indique le nombre de tentatives restantes avant blocage.
	#
	suffix = "tentative" if remaining_attempts == 1 else "tentatives"
	return (
		"Identifiant ou mot de passe incorrect, "
		f"il vous reste {remaining_attempts} {suffix}."
	)


def reinitialiser_tentatives_connexion() -> None:  # Efface le compteur de tentatives et le timestamp de verrou de la session Flask
	#
	# Efface le compteur de tentatives et le timestamp de verrou de la session Flask.
	# Appelé après une connexion réussie ou quand le verrou expire.
	#
	session.pop("login_attempts", None)
	session.pop("login_lock_until", None)


def normaliser_role(role: str) -> str:  # Normalise un rôle utilisateur en deux valeurs possibles : "admin" ou "user"
	#
	# Normalise un rôle utilisateur en deux valeurs possibles : "admin" ou "user".
	# Les valeurs "admin" et "administrateur" donnent "admin", tout le reste donne "user".
	#
	role_norm = str(role or "").strip().lower()
	if role_norm in {"admin", "administrateur"}:
		return "admin"
	return "user"


def normaliser_hash_bcrypt(stored_password) -> str:  # Normalise une valeur de mot de passe stockée pour qu'elle soit compatible bcrypt
	# Normalise une valeur de mot de passe stockée pour qu'elle soit compatible bcrypt.
	# Corrige les formats mal stockés par PHP ou d'autres systèmes avant vérification.
	#
	if isinstance(stored_password, bytes):
		text = stored_password.decode("utf-8", errors="ignore")
	else:
		text = str(stored_password or "")

	text = text.strip()

	# Gère les valeurs stockées sous forme de bytes encodées en chaîne,
	# par exemple b'$2b$...' ou b"$2b$...".
	if text.startswith("b'") and text.endswith("'"):
		text = text[2:-1]
	elif text.startswith('b"') and text.endswith('"'):
		text = text[2:-1]

	# Les hash bcrypt PHP utilisent parfois $2y$, Python bcrypt attend $2b$.
	if text.startswith("$2y$"):
		text = "$2b$" + text[4:]

	# Some rows are malformed and miss the bcrypt version, e.g. "$12$..."
	# Rebuild to a valid bcrypt prefix expected by python-bcrypt.
	if text.startswith("$12$"):
		text = "$2b$12$" + text[4:]

	return text


def verifier_mot_de_passe(password: str, stored_password) -> bool:  # Compare un mot de passe en clair avec un hash bcrypt stocké en base
	#
	# Compare un mot de passe en clair avec un hash bcrypt stocké en base.
	# Passe d'abord par normaliser_hash_bcrypt() pour corriger les formats mal stockés
	# ($2y$, b'...', $12$...). Refuse tout mot de passe non hashé (fallback texte clair supprimé).
	#
	stored = normaliser_hash_bcrypt(stored_password)
	if not stored:
		return False

	if stored.startswith("$2b$") or stored.startswith("$2a$"):
		try:
			return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
		except ValueError:
			return False

	# Refus des mots de passe non hachés — toujours utiliser bcrypt
	return False


def enregistrer_tentative_echec() -> int:  # Incremente le compteur de tentatives échouées dans la session Flask
	#
	# Incremente le compteur de tentatives échouées dans la session Flask.
	# Si la limite MAX_LOGIN_ATTEMPTS est atteinte, pose le verrou temporaire.
	# Donne le nombre total de tentatives depuis le début.
	#
	attempts = int(session.get("login_attempts", 0) or 0) + 1
	session["login_attempts"] = attempts

	if attempts >= MAX_LOGIN_ATTEMPTS:
		session["login_lock_until"] = time.time() + LOCK_DURATION_SECONDS

	return attempts


def authentifier_utilisateur(username: str, password: str) -> tuple:  # Vérifie les identifiants contre la table MySQL `users` (comparaison insensible à la casse)
	#
	# Vérifie les identifiants contre la table MySQL `users` (comparaison insensible à la casse).
	# Donne (True, user_dict) si OK, (False, None) si identifiants incorrects ou erreur MySQL.
	#
	if not username or not password:
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
def connexion():  # Page de connexion (GET /login et POST /login)
	#
	# Page de connexion (GET /login et POST /login).
	# GET : affiche le formulaire avec un token CSRF frais.
	# POST : valide le CSRF, vérifie le verrou anti-brute-force, authentifie via MySQL.
	# En cas de succès : remplit la session et redirige vers l'accueil.
	# En cas d'échec : incrémente le compteur, affiche le message d'erreur.
	#
	remaining = obtenir_secondes_verrou_restantes()

	if remaining == 0 and session.get("login_lock_until"):
		reinitialiser_tentatives_connexion()

	if request.method == "POST":
		# Validation CSRF
		token_form = request.form.get("_csrf_token", "")
		token_session = session.get("_csrf_token", "")
		if not token_form or not secrets.compare_digest(token_form, token_session):
			session["login_error"] = "Requête invalide. Veuillez réessayer."
			return redirect(url_for("login.connexion"))

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

	# Génération du token CSRF pour le formulaire
	csrf_token = secrets.token_hex(32)
	session["_csrf_token"] = csrf_token

	return render_template("login/login.html", error=error, locked=locked, csrf_token=csrf_token)


@login_bp.route("/logout")
def deconnexion():  # Déconnecte l'utilisateur en supprimant les clés de session is_authenticated et role
	#
	# Déconnecte l'utilisateur en supprimant les clés de session is_authenticated et role.
	# Redirige ensuite vers la page de connexion.
	#
	session.pop("is_authenticated", None)
	session.pop("role", None)
	return redirect(url_for("login.connexion"))





def is_admin():  # Donne True si l'utilisateur actuellement connecté a le rôle "admin" en session
	#
	# Donne True si l'utilisateur actuellement connecté a le rôle "admin" en session.
	#
	return session.get("role") == "admin"


def require_admin_role():  # Protège les routes qui ne doivent être accessibles qu'aux admins
	#
	# Protège les routes qui ne doivent être accessibles qu'aux admins.
	# Si l'utilisateur n'est pas admin, on renvoie une erreur 403.
	#
	# Fonction qui vérifie l'autorisation admin.
	def decorator(f):  # Crée le décorateur qui protège une route admin
		# Crée le décorateur qui protège une route admin.
		@wraps(f)
		# Fonction décorée qui vérifie la session et la permission admin.
		def decorated_function(*args, **kwargs):  # Vérifie si l'utilisateur est admin avant d'appeler la vraie fonction
			# Vérifie si l'utilisateur est admin avant d'appeler la vraie fonction.
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
CERTS_DIR = Path(os.environ.get("CERTS_DIR", "/certs"))


@accueil_bp.route("/")
def accueil():  # Redirige la racine / vers /accueil
	# Redirige la racine / vers /accueil.
	return redirect(url_for("accueil.accueil_page"))


@accueil_bp.route("/ca.crt")
def download_ca_cert():  # Télécharge le certificat CA (accessible aux utilisateurs authentifiés)
	# Télécharge le certificat CA (accessible aux utilisateurs authentifiés).
	if not session.get("is_authenticated"):
		return redirect(url_for("login.connexion"))
	cert_path = CERTS_DIR / "ca.crt"
	if not cert_path.is_file():
		return "Certificat non disponible", 404
	return send_from_directory(str(CERTS_DIR), "ca.crt", as_attachment=True)


@accueil_bp.route("/accueil")
def accueil_page():  # Affiche la page d'accueil avec le carousel de sélection d'équipement
	#
	# Affiche la page d'accueil avec le carousel de sélection d'équipement.
	# Lit le nom personnalisé de l'application depuis les réglages MySQL (id=1).
	# Nécessite d'être connecté, sinon redirige vers le login.
	#
	if not session.get("is_authenticated"):
		return redirect(url_for("login.connexion"))
	current = lire_reglages_mysql((1,))
	nom_app = current.get(1, "")
	return render_template("accueil/accueil.html", nom_app=nom_app)


# ---------------------------------------------------------------------------
# Réglages (admin uniquement)
# ---------------------------------------------------------------------------
reglages_bp = Blueprint("reglages", __name__, url_prefix="/reglages")


@reglages_bp.route("", methods=["GET"])
def reglages_page():  # Affiche la page de réglages (GET /reglages)
	#
	# Affiche la page de réglages (GET /reglages).
	# Accessible uniquement aux administrateurs connectés.
	# Passe au template : le nom de l'app, les limites d'équipements et la liste des utilisateurs.
	#
	if not session.get("is_authenticated"):
		return redirect(url_for("login.connexion"))
	if not is_admin():
		return redirect(url_for("accueil.accueil_page"))
	current = lire_reglages_mysql((1, 2, 3, 4))
	users = lire_utilisateurs_mysql()
	return render_template(
		"reglages/reglages.html",
		reglages_nom=current.get(1, ""),
		reglages_cm=current.get(2, ""),
		reglages_cpo=current.get(3, ""),
		reglages_c2=current.get(4, ""),
		users=users,
	)


@reglages_bp.route("", methods=["POST"])
@require_admin_role()
def reglages_save():  # Sauvegarde les réglages (POST /reglages, JSON)
	#
	# Sauvegarde les réglages (POST /reglages, JSON).
	# Champs attendus : nom (str), valeur1 (nb CM), valeur2 (nb CPO), valeur3 (nb C2).
	# Les champs absents ou vides conservent leur valeur actuelle en base.
	# Donne {ok: true} ou {error: ...} avec le code HTTP approprié.
	#
	data = request.get_json(silent=True) or {}
	nom_raw = data.get("nom")
	valeur1_raw = data.get("valeur1")
	valeur2_raw = data.get("valeur2")
	valeur3_raw = data.get("valeur3")

	nom = str(nom_raw or "").strip()

	# Limites de validation pour les champs de réglage. Ces valeurs sont liées aux
	# constantes MAX_REGLAGE_CM / MAX_REGLAGE_CPO / MAX_REGLAGE_C2 définies plus haut.
	# Si vous changez ces constantes, les mêmes limites seront appliquées ici.
	field_limits = {
		"Valeur 1": MAX_REGLAGE_CM,
		"Valeur 2": MAX_REGLAGE_CPO,
		"Valeur 3": MAX_REGLAGE_C2,
	}

	for label, raw_val in [("Valeur 1", valeur1_raw), ("Valeur 2", valeur2_raw), ("Valeur 3", valeur3_raw)]:
		if raw_val is None or str(raw_val).strip() == "":
			continue
		try:
			n = float(raw_val)
		except (TypeError, ValueError):
			return {"error": f"{label} doit être un nombre valide."}, 400
		if n <= 0:
			return {"error": f"{label} doit etre strictement superieur a 0."}, 400
		max_allowed = field_limits.get(label)
		if max_allowed is not None and n > max_allowed:
			if label == "Valeur 1":
				return {"error": f"erreur vous pouvez définir au maximum {MAX_REGLAGE_CM} contrôleurs mobiles"}, 400
			if label == "Valeur 2":
				return {"error": f"erreur vous pouvez définir au maximum {MAX_REGLAGE_CPO} CPO"}, 400
			if label == "Valeur 3":
				return {"error": f"erreur vous pouvez définir au maximum {MAX_REGLAGE_C2} C2"}, 400
		if n > 99:
			return {"error": f"{label} ne peut pas dépasser 99."}, 400

	current = lire_reglages_mysql((1, 2, 3, 4))

	valeur1 = str(valeur1_raw).strip() if valeur1_raw is not None and str(valeur1_raw).strip() != "" else current.get(2, "")
	valeur2 = str(valeur2_raw).strip() if valeur2_raw is not None and str(valeur2_raw).strip() != "" else current.get(3, "")
	valeur3 = str(valeur3_raw).strip() if valeur3_raw is not None and str(valeur3_raw).strip() != "" else current.get(4, "")

	if not nom:
		nom = current.get(1, "")

	reglages = [
		(1, "nom", nom),
		(2, "CM", valeur1),
		(3, "CPO", valeur2),
		(4, "C2", valeur3),
	]

	ok, err = enregistrer_reglages_mysql(reglages)
	if not ok:
		print("MySQL reglage save error:", err)
		return {"error": "Erreur MySQL reglage."}, 500

	return {"ok": True}, 200


@reglages_bp.route("/users", methods=["POST"])
@require_admin_role()
def reglages_add_user():  # Ajoute un utilisateur (POST /reglages/users, JSON)
	#
	# Ajoute un utilisateur (POST /reglages/users, JSON).
	# Champs attendus : username (str), password (str, 6 car. min), role (str).
	# Le mot de passe est hashé en bcrypt avant insertion en base.
	# Donne {ok: true} ou {error: ...} avec le code HTTP approprié.
	#
	data = request.get_json(silent=True) or {}
	username = str(data.get("username", "")).strip()
	password = str(data.get("password", ""))
	role = str(data.get("role", "utilisateur")).strip().lower()

	if not username:
		return jsonify({"error": "Nom d'utilisateur requis."}), 400
	if not password or len(password) < 6:
		return jsonify({"error": "Mot de passe requis (6 caractères min)."}), 400
	if role in {"admin", "administrateur"}:
		role = "administrateur"
	else:
		role = "utilisateur"

	ok, err = ajouter_utilisateur_mysql(username, password, role)
	if not ok:
		return jsonify({"error": err or "Erreur ajout utilisateur."}), 400

	return jsonify({"ok": True}), 200


@reglages_bp.route("/users/<int:user_id>", methods=["DELETE"])
@require_admin_role()
def reglages_delete_user(user_id):  # Supprime un utilisateur (DELETE /reglages/users/<id>)
	#
	# Supprime un utilisateur (DELETE /reglages/users/<id>).
	# Interdiction de supprimer son propre compte (comparaison avec session user_id).
	# Donne {ok: true} ou {error: ...} avec le code HTTP approprié.
	#
	current_user_id = session.get("user_id")
	try:
		current_user_id = int(current_user_id)
	except (TypeError, ValueError):
		current_user_id = None

	if current_user_id == user_id:
		return jsonify({"error": "Vous ne pouvez pas supprimer votre propre compte."}), 400

	ok, err = supprimer_utilisateur_mysql(user_id)
	if not ok:
		return jsonify({"error": err or "Erreur suppression utilisateur."}), 400

	return jsonify({"ok": True}), 200


@accueil_bp.route("/menu")
def menu():  # Redirige /menu vers /accueil (alias de navigation)
	# Redirige /menu vers /accueil (alias de navigation).
	return redirect(url_for("accueil.accueil_page"))


@accueil_bp.route("/initialisateur")
def initialisateur_root():  # Redirige /initialisateur vers /initialisateur/index.html
	# Redirige /initialisateur vers /initialisateur/index.html.
	return redirect(url_for("accueil.initialisateur_index"))


@accueil_bp.route("/initialisateur/")
@accueil_bp.route("/initialisateur/index.html")
def initialisateur_index():  # Sert le fichier index.html du module App_initialisateur (application autonome
	#
	# Sert le fichier index.html du module App_initialisateur (application autonome
	# pour l'initialisation de badges et de dosimètres, indépendante de Flask).
	#
	return send_from_directory(INITIALISATEUR_DIR, "index.html")


@accueil_bp.route("/initialisateur/<path:filename>")
def initialisateur_files(filename: str):  # Sert les fichiers statiques du module App_initialisateur (JS, CSS, images, etc.)
	#
	# Sert les fichiers statiques du module App_initialisateur (JS, CSS, images, etc.).
	# Permet de référencer le dossier App_initialisateur depuis l'URL /initialisateur/.
	#
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
c2_names = {}
c2_values = {}
deleted_c2_ids: set[int] = set()


def ids_c2_actifs() -> list[int]:  # Donne la liste triée des IDs de portiques C2 actifs (non supprimés)
	#
	# Donne la liste triée des IDs de portiques C2 actifs (non supprimés)
	# en se basant sur c2_names et deleted_c2_ids.
	#
	return ids_triees(i for i in c2_names.keys() if i not in deleted_c2_ids)


def rafraichir_c2_depuis_mysql():  # Synchronise le dictionnaire en mémoire c2_names et les genres de c2_values
	#
	# Synchronise le dictionnaire en mémoire c2_names et les genres de c2_values
	# depuis la table MySQL `equipements`. Supprime les entrées obsolètes.
	# Appelé au début de chaque route C2 pour avoir des données à jour.
	#
	if not USE_MYSQL:
		return
	names, genres = lire_equipements_mysql(("C2",))
	c2_names.clear()
	c2_names.update(names)
	deleted_c2_ids.intersection_update(set(c2_names.keys()))
	for c2_id in list(c2_values.keys()):
		if c2_id not in c2_names:
			c2_values.pop(c2_id, None)
	for c2_id, genre_code in genres.items():
		entry = garantir_genre_entry(c2_values.get(c2_id, entree_c2_defaut()))
		if genre_code is not None:
			entry["genre"] = genre_code
		c2_values[c2_id] = entry


def normaliser_liste_numerique(values):  # Filtre une liste quelconque pour ne garder que les entiers valides,
	#
	# Filtre une liste quelconque pour ne garder que les entiers valides,
	# dupliqués exclus, triés. Ignore les éléments non convertibles en int.
	#
	if not isinstance(values, list):
		return []

	result = []
	for value in values:
		try:
			result.append(int(value))
		except (TypeError, ValueError):
			continue

	return sorted(set(result))


def parser_liste_capteurs_texte(raw: str):  # Parse un payload MQTT de capteurs au format texte ($01;09;15;00) en liste d'entiers
	#
	# Parse un payload MQTT de capteurs au format texte ($01;09;15;00) en liste d'entiers.
	# Supprime le $ initial, ignore le token de fin 00, gère aussi le format avec virgule.
	# Donne une liste triée sans doublons.
	#
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


def extraire_ids_capteurs_numeriques(values: dict, prefix: str):  # Extrait les IDs numériques des capteurs actifs depuis un dict JS {"c1": true, "c3": false}
	#
	# Extrait les IDs numériques des capteurs actifs depuis un dict JS {"c1": true, "c3": false}.
	# Filtres : la valeur doit être truthy et la clé doit commencer par prefix ("c" pour FACE,
	# "dos" pour DOS). Donne une liste triée sans doublons.
	#
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


def formater_tableau(values):  # Formate une liste d'IDs de capteurs en payload MQTT : "$01;09;15;00"
	#
	# Formate une liste d'IDs de capteurs en payload MQTT : "$01;09;15;00".
	# Chaque numéro est formaté sur 2 chiffres, séparés par ";", terminé par ";00".
	# Donne "$00" si la liste est vide.
	#
	if not values:
		return "$00"

	formatted = [f"{int(v):02d}" for v in values]
	return f"${';'.join(formatted)};00"


def normaliser_genre(value, default="M"):  # Normalise un genre en code interne "M" ou "F"
	#
	# Normalise un genre en code interne "M" ou "F".
	# Accepte : M, H, HOMME → "M" ; F, FEMME → "F".
	# Donne default si la valeur est inconnue.
	#
	text = str(value or "").strip().upper()
	if text in {"M", "H", "HOMME"}:
		return "M"
	if text in {"F", "FEMME"}:
		return "F"
	return default


def genre_ui(value):  # Convertit le code genre interne ("M"/"F") en valeur pour l'interface :
	#
	# Convertit le code genre interne ("M"/"F") en valeur pour l'interface :
	# "femme" si F, "homme" dans tous les autres cas.
	#
	return "femme" if normaliser_genre(value) == "F" else "homme"


def genre_aleatoire():  # Donne un code genre aléatoire ("M" ou "F")
	#
	# Donne un code genre aléatoire ("M" ou "F").
	# Pour initialiser le genre d'un nouveau portique C2 sans genre défini.
	#
	return random.choice(["M", "F"])


def garantir_genre_entry(entry):  # S'assure qu'une entrée C2 (dict) contient les clés obligatoires F, D et genre
	#
	# S'assure qu'une entrée C2 (dict) contient les clés obligatoires F, D et genre.
	# Crée les clés manquantes avec des valeurs par défaut. Si genre est absent ou invalide,
	# assigne un genre aléatoire. Donne l'entrée corrigée.
	#
	if not isinstance(entry, dict):
		entry = {"F": [], "D": []}

	entry.setdefault("F", [])
	entry.setdefault("D", [])
	entry["genre"] = normaliser_genre(entry.get("genre"), None) or genre_aleatoire()
	return entry


def entree_c2_defaut():  # Crée et retourne une entrée C2 vide : capteurs FACE et DOS vides, genre aléatoire
	#
	# Crée et retourne une entrée C2 vide : capteurs FACE et DOS vides, genre aléatoire.
	# Utilisée pour initialiser un nouveau portique sans données MQTT reçues.
	#
	return garantir_genre_entry({"F": [], "D": []})


def analyser_charge_capteurs(payload: str):  # Lit un payload MQTT de capteurs en plusieurs formats
	#
	# Lit un payload MQTT de capteurs en plusieurs formats.
	# Il peut être JSON ou texte.
	# Donne deux listes : capteurs FACE et capteurs DOS.
	#
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

	# Analyse une chaîne contenant une liste de nombres séparés par ; ou ,
	# et retourne une liste triée sans doublons.
	def _parse_array(raw: str):  # Lit une chaîne et en extrait les nombres valides
		# Lit une chaîne et en extrait les nombres valides.
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


def extraire_id_numerique_c2(c2_token: str):  # Extrait l'ID numérique d'un token C2 comme "C2_3", "C2-3", "C2 3" ou "3"
	#
	# Extrait l'ID numérique d'un token C2 comme "C2_3", "C2-3", "C2 3" ou "3".
	# Pour parser l'ID depuis un topic MQTT ou un paramètre de formulaire.
	# Donne None si aucun nombre n'est trouvé.
	#
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


def extraire_id_appareil(name: str, device_type: str):  # Extrait l'ID numérique depuis un nom d'appareil générique ("CPO 2", "CM-3", etc.)
	#
	# Extrait l'ID numérique depuis un nom d'appareil générique ("CPO 2", "CM-3", etc.).
	# Vérifie que le nom commence par device_type, puis cherche le premier nombre après le préfixe.
	# Donne None si le nom est invalide ou ne contient pas de chiffres.
	#
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


mqtt_client_c2 = mqtt.Client(client_id=f"IHM_C2_{uuid.uuid4().hex[:8]}")

def connecter_mqtt_c2(client, userdata, flags, rc):  # Fonction MQTT on_connect pour le module C2
	#
	# Fonction MQTT on_connect pour le module C2.
	# S'abonne aux 4 topics C2 (legacy Capteurs, CapteursFace, CapteursDos, Genre)
	# avec wildcard + pour couvrir tous les portiques.
	#
	try:
		client.subscribe(TOPIC_C2_CAPTEURS_LEGACY)
		client.subscribe(TOPIC_C2_CAPTEURS_FACE)
		client.subscribe(TOPIC_C2_CAPTEURS_DOS)
		client.subscribe(TOPIC_C2_GENRE)
		print(f"C2 MQTT connected (rc={rc}) and subscribed", flush=True)
	except Exception as exc:
		print("MQTT on_connect subscribe error:", exc)

def traiter_message_mqtt_c2(client, userdata, msg):  # Fonction MQTT on_message pour le module C2
	#
	# Fonction MQTT on_message pour le module C2.
	# Dis-patche le message reçu vers la bonne clé de c2_values selon le topic suffix :
	# - CapteursFace → c2_values[id]["F"]
	# - CapteursDos  → c2_values[id]["D"]
	# - Genre        → c2_values[id]["genre"]
	# - Capteurs (legacy) → analyse complète du payload JSON/texte.
	# Ignore les messages pour des portiques inconnus ou supprimés.
	#
	try:
		c2_id = extraire_id_numerique_c2(parts[2])
		if c2_id is None or c2_id < 1:
			return
		if c2_id in deleted_c2_ids:
			return
		if c2_id not in c2_names:
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

	except Exception as exc:
		print("MQTT on_message error:", exc)

mqtt_client_c2 = configurer_demarrer_mqtt(mqtt_client_c2, connecter_mqtt_c2, traiter_message_mqtt_c2)


@c2_bp.route("/")
def accueil_c2():  # Redirige /C2/ vers /C2/1 (premier portique par défaut)
	# Redirige /C2/ vers /C2/1 (premier portique par défaut).
	return redirect(url_for("c2.afficher_page_c2", c2_id=1))


@c2_bp.route("/<int:c2_id>")
def afficher_page_c2(c2_id: int):  # Affiche la page d'interface du portique C2 demandé (GET /C2/<id>)
	#
	# Affiche la page d'interface du portique C2 demandé (GET /C2/<id>).
	# Synchronise depuis MySQL, redirige vers un ID valide si nécessaire.
	# Passe au template : l'ID courant, les noms de tous les C2, le genre et le rôle.
	# Affiche un écran "aucun équipement" si la liste est vide.
	#
	rafraichir_c2_depuis_mysql()
	max_c2 = lire_limite_reglage_mysql(4, 4)

	if c2_id < 1:
		c2_id = 1

	actifs = ids_c2_actifs()
	if not actifs:
		return render_template(
			"c2/C2.html",
			c2_id=0,
			c2_names={},
			c2_ids=[],
			max_c2=max_c2,
			current_gender="homme",
			role=session.get("role", "user"),
			has_equipment=False,
		)
	if c2_id not in actifs:
		cible = actifs[0]
		return redirect(url_for("c2.afficher_page_c2", c2_id=cible))

	if c2_id in deleted_c2_ids:
		cible = actifs[0] if actifs else 1
		return redirect(url_for("c2.afficher_page_c2", c2_id=cible))

	if c2_id not in c2_values:
		c2_values[c2_id] = entree_c2_defaut()
	else:
		c2_values[c2_id] = garantir_genre_entry(c2_values[c2_id])

	return render_template(
		"c2/C2.html",
		c2_id=c2_id,
		c2_names=c2_names,
		c2_ids=ids_c2_actifs(),
		max_c2=max_c2,
		current_gender=genre_ui(c2_values[c2_id].get("genre", "M")),
		role=session.get("role", "user"),
		has_equipment=True,
	)


@c2_bp.route("/publish_capteurs_full", methods=["POST"])
def publier_capteurs_complet():  # Recoit les capteurs actifs depuis l'interface web et publie sur MQTT (POST /C2/publish_capteurs_full)
	#
	# Recoit les capteurs actifs depuis l'interface web et publie sur MQTT (POST /C2/publish_capteurs_full).
	# Accepte les données en form-data ou JSON. Publie sur 3 topics :
	# FormaReaEDF/C2/{id}/CapteursFace, CapteursDos, Genre.
	# Synchronise aussi le genre en base MySQL. Donne un JSON de confirmation.
	#
	rafraichir_c2_depuis_mysql()
	raw_c2_id = request.values.get("c2_id")
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
		if c2_numeric_id in deleted_c2_ids:
			return jsonify({"status": "error", "error": "c2_deleted"}), 400
		if c2_numeric_id not in ids_c2_actifs():
			return jsonify({"status": "error", "error": "c2_unknown"}), 404
		c2_values[c2_numeric_id] = garantir_genre_entry({"F": f_list, "D": d_list, "genre": genre_code})

		sync_ok, sync_err = enregistrer_equipement_mysql(
			c2_numeric_id,
			c2_names.get(c2_numeric_id, f"C2 ID {c2_numeric_id}"),
			"C2",
			genre_code,
		)
		if not sync_ok:
			print("MySQL equipements sync error:", sync_err)
			return jsonify({"status": "error", "error": "mysql_equipements_sync_failed"}), 500

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
def ajouter_appareil_c2():  # Crée un nouveau portique C2 (POST /C2/ajouter-appareil, admin uniquement)
	#
	# Crée un nouveau portique C2 (POST /C2/ajouter-appareil, admin uniquement).
	# Vérifie : nom obligatoire, genre obligatoire, ID dans les limites, ID non dupliqué.
	# Enregistre en mémoire et en MySQL, publie le genre sur MQTT avec retain.
	# Donne {ok: true, genre, c2_id} ou {ok: false, error}.
	#
	rafraichir_c2_depuis_mysql()
	max_c2 = lire_limite_reglage_mysql(4, 4)
	name = request.form.get("name", "")
	c2_id = lire_id_formulaire()
	genre_code = normaliser_genre(request.form.get("gender"), None)

	if not str(name or "").strip():
		return jsonify(ok=False, error="Le nom est obligatoire."), 400
	if genre_code is None:
		return jsonify(ok=False, error="Le genre est obligatoire."), 400
	if c2_id is None or c2_id < 1 or c2_id > max_c2:
		return jsonify(ok=False, error=f"ID C2 invalide (1 a {max_c2})."), 400
	if len(ids_c2_actifs()) >= max_c2:
		return jsonify(ok=False, error=f"Limite C2 atteinte ({max_c2})."), 400
	if c2_id in ids_c2_actifs():
		return jsonify(ok=False, error="Cet ID est deja assigne."), 400

	c2_names[c2_id] = str(name).strip()
	deleted_c2_ids.discard(c2_id)
	entry = garantir_genre_entry(c2_values.get(c2_id, entree_c2_defaut()))
	entry["genre"] = genre_code
	c2_values[c2_id] = entry

	sync_ok, sync_err = enregistrer_equipement_mysql(c2_id, c2_names[c2_id], "C2", genre_code)
	if not sync_ok:
		print("MySQL equipements sync error:", sync_err)
		return jsonify(ok=False, error="Erreur MySQL equipements."), 500

	if mqtt_client_c2:
		try:
			mqtt_client_c2.publish(f"FormaReaEDF/C2/C2_{c2_id}/Genre", genre_code, qos=1, retain=True)
		except Exception as exc:
			print("MQTT publish error:", exc)
			return jsonify(ok=False, error="Publication MQTT impossible."), 500

	print(f"C2 No{c2_id} a ete cree")
	return jsonify(ok=True, genre=genre_code, c2_id=c2_id)


@c2_bp.route("/supprimer-appareil", methods=["POST"])
@require_admin_role()
def supprimer_appareil_c2():  # Supprime un portique C2 (POST /C2/supprimer-appareil, admin uniquement)
	#
	# Supprime un portique C2 (POST /C2/supprimer-appareil, admin uniquement).
	# Retire l'entrée de c2_names et c2_values, l'ajoute à deleted_c2_ids, supprime en MySQL.
	# Efface les messages MQTT retainés (payload vide) sur les 3 topics du portique.
	# Donne {ok: true} ou {ok: false, error}.
	#
	rafraichir_c2_depuis_mysql()

	c2_id = lire_id_formulaire()
	if c2_id is None:
		return jsonify(ok=False, error="ID invalide."), 400

	if c2_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	deleted_c2_ids.add(c2_id)
	c2_names.pop(c2_id, None)
	c2_values.pop(c2_id, None)

	db_ok, db_err = supprimer_equipement_mysql(c2_id, "C2")
	if not db_ok:
		print("MySQL equipements delete error:", db_err)
		return jsonify(ok=False, error="Erreur MySQL equipements."), 500

	if mqtt_client_c2:
		try:
			mqtt_client_c2.publish(f"FormaReaEDF/C2/C2_{c2_id}/CapteursFace", "", qos=1, retain=True)
			mqtt_client_c2.publish(f"FormaReaEDF/C2/C2_{c2_id}/CapteursDos", "", qos=1, retain=True)
			mqtt_client_c2.publish(f"FormaReaEDF/C2/C2_{c2_id}/Genre", "", qos=1, retain=True)
		except Exception as exc:
			print("MQTT clear retained error:", exc)

	print(f"C2 No{c2_id} a ete supprime")
	return jsonify(ok=True)


@c2_bp.route("/state/<int:c2_id>")
def obtenir_etat_c2(c2_id: int):  # Donne l'état JSON d'un portique C2 (GET /C2/state/<id>)
	#
	# Donne l'état JSON d'un portique C2 (GET /C2/state/<id>).
	# Utilisé par le polling JavaScript toutes les secondes pour détecter les changements.
	# Donne : {ok, c2_id, F: [liste], D: [liste], genre}. Headers no-cache appliqués.
	#
	rafraichir_c2_depuis_mysql()

	if c2_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400
	if c2_id in deleted_c2_ids:
		return jsonify(ok=False, error="ID supprime."), 404
	if c2_id not in ids_c2_actifs():
		return jsonify(ok=False, error="ID inconnu."), 404

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
TOPIC_CM_BRUIT_FOND_WILDCARD = "FormaReaEDF/ControllerMobile/+/NivBruitFond"
TOPIC_CM_STATUS_WILDCARD = "FormaReaEDF/ControllerMobile/+/Status"


def entree_par_defaut_cm():  # Donne les valeurs par défaut d'un contrôleur mobile :
	#
	# Donne les valeurs par défaut d'un contrôleur mobile :
	# NivContamination=1, NivBruitFond=1, Status=0.
	#
	# Valeurs par défaut initiales pour une nouvelle page CM ou un CM sans données.
	# Modifier ici si vous souhaitez changer le niveau initial chargé dans l'UI.
	return {"NivContamination": "1", "NivBruitFond": "1", "Status": "0"}


def topic_contamination_cm(cm_id: int) -> str:  # Génère le topic MQTT de contamination pour un CM donné : FormaReaEDF/ControllerMobile/CM_{id}/NivContamination
	# Génère le topic MQTT de contamination pour un CM donné : FormaReaEDF/ControllerMobile/CM_{id}/NivContamination.
	return f"FormaReaEDF/ControllerMobile/CM_{cm_id}/NivContamination"


def topic_status_cm(cm_id: int) -> str:  # Génère le topic MQTT de statut pour un CM donné : FormaReaEDF/ControllerMobile/CM_{id}/Status
	# Génère le topic MQTT de statut pour un CM donné : FormaReaEDF/ControllerMobile/CM_{id}/Status.
	return f"FormaReaEDF/ControllerMobile/CM_{cm_id}/Status"


def topic_bruit_fond_cm(cm_id: int) -> str:  # Génère le topic MQTT de bruit de fond pour un CM donné : FormaReaEDF/ControllerMobile/CM_{id}/NivBruitFond
	# Génère le topic MQTT de bruit de fond pour un CM donné : FormaReaEDF/ControllerMobile/CM_{id}/NivBruitFond.
	return f"FormaReaEDF/ControllerMobile/CM_{cm_id}/NivBruitFond"


last_values_cm = {}
cm_names = {}
deleted_cm_ids: set[int] = set()
mqtt_client_cm = None


def ids_cm_actifs() -> list[int]:  # Donne la liste triée des IDs de contrôleurs mobiles actifs (non supprimés)
	#
	# Donne la liste triée des IDs de contrôleurs mobiles actifs (non supprimés)
	# en se basant sur cm_names et deleted_cm_ids.
	#
	return ids_triees(i for i in cm_names.keys() if i not in deleted_cm_ids)


def rafraichir_cm_depuis_mysql():  # Synchronise le dictionnaire cm_names depuis MySQL (types MIP10, CM, CONTROLLERMOBILE)
	#
	# Synchronise le dictionnaire cm_names depuis MySQL (types MIP10, CM, CONTROLLERMOBILE).
	# Supprime les entrées obsolètes de last_values_cm. Appelé en début de chaque route CM.
	#
	if not USE_MYSQL:
		return
	names, _ = lire_equipements_mysql(("MIP10", "CM", "CONTROLLERMOBILE"))
	cm_names.clear()
	cm_names.update(names)
	deleted_cm_ids.intersection_update(set(cm_names.keys()))
	for cm_id in list(last_values_cm.keys()):
		if cm_id not in cm_names:
			last_values_cm.pop(cm_id, None)


def initialiser_mqtt_cm(cm_id: int):  # Publie les valeurs actuelles d'un CM sur MQTT avec retain=True
	#
	# Publie les valeurs actuelles d'un CM sur MQTT avec retain=True.
	# Appelé à la création d'un CM ou à la reconnexion du client MQTT.
	# Publie contamination, bruit de fond et statut.
	#
	if not mqtt_client_cm:
		return

	last_values_cm[cm_id].setdefault("Status", "0")
	last_values_cm[cm_id].setdefault("NivBruitFond", "1")
	mqtt_client_cm.publish(topic_contamination_cm(cm_id), f"{last_values_cm[cm_id]['NivContamination']}", retain=True)
	mqtt_client_cm.publish(topic_bruit_fond_cm(cm_id), f"{last_values_cm[cm_id]['NivBruitFond']}", retain=True)
	mqtt_client_cm.publish(topic_status_cm(cm_id), f"{last_values_cm[cm_id]['Status']}", retain=True)


def deconnecter_mqtt_cm(cm_id: int):  # Efface les messages MQTT retainés d'un CM en publiant un payload vide sur ses 3 topics
	#
	# Efface les messages MQTT retainés d'un CM en publiant un payload vide sur ses 3 topics.
	# Appelé lors de la suppression d'un CM pour nettoyer le broker.
	#
	if not mqtt_client_cm:
		return

	mqtt_client_cm.publish(topic_contamination_cm(cm_id), "", retain=True)
	mqtt_client_cm.publish(topic_bruit_fond_cm(cm_id), "", retain=True)
	mqtt_client_cm.publish(topic_status_cm(cm_id), "", retain=True)


def on_connect_mqtt_cm(client, userdata, flags, rc):  # Fonction MQTT on_connect pour le module CM
	#
	# Fonction MQTT on_connect pour le module CM.
	# S'abonne aux 3 topics CM (NivContamination, NivBruitFond, Status) avec wildcard +.
	# Ré-publie les valeurs actuelles de tous les CM actifs après reconnexion.
	#
	if rc != 0:
		print(f"MQTT connect failed: rc={rc}")
		return

	try:
		result_conta, _ = client.subscribe(TOPIC_CM_CONTAMINATION_WILDCARD, qos=0)
		result_bdf, _ = client.subscribe(TOPIC_CM_BRUIT_FOND_WILDCARD, qos=0)
		result_status, _ = client.subscribe(TOPIC_CM_STATUS_WILDCARD, qos=0)
	except ValueError as exc:
		print(f"MQTT subscribe filter error: {exc}")
		return

	if result_conta != mqtt.MQTT_ERR_SUCCESS:
		print(f"MQTT subscribe failed for {TOPIC_CM_CONTAMINATION_WILDCARD}: {result_conta}")
	if result_bdf != mqtt.MQTT_ERR_SUCCESS:
		print(f"MQTT subscribe failed for {TOPIC_CM_BRUIT_FOND_WILDCARD}: {result_bdf}")
	if result_status != mqtt.MQTT_ERR_SUCCESS:
		print(f"MQTT subscribe failed for {TOPIC_CM_STATUS_WILDCARD}: {result_status}")

	for cm_id in list(last_values_cm.keys()):
		if cm_id not in deleted_cm_ids:
			initialiser_mqtt_cm(cm_id)


def traiter_message_mqtt_cm(client, userdata, msg):  # Fonction MQTT on_message pour le module CM
	#
	# Fonction MQTT on_message pour le module CM.
	# Met à jour last_values_cm[id] selon le topic reçu :
	# - NivContamination → valeur nettoyée (sans unité Bq)
	# - NivBruitFond     → valeur nettoyée
	# - Status           → "1" ou "0" uniquement
	# Ignore les messages pour des CM inconnus, supprimés ou mal formés.
	#
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
		elif "NivBruitFond" in msg.topic:
			last_values_cm[cm_id]["NivBruitFond"] = payload
		elif msg.topic.lower().endswith("/status"):
			last_values_cm[cm_id]["Status"] = "1" if str(payload).strip() == "1" else "0"

	except Exception as exc:
		print("MQTT on_message error:", exc)


if USE_MQTT:
	mqtt_client_cm = mqtt.Client(client_id="IHM_ControllerMobile", protocol=mqtt.MQTTv311)
	mqtt_client_cm = configurer_demarrer_mqtt(mqtt_client_cm, on_connect_mqtt_cm, traiter_message_mqtt_cm)


@cm_bp.route("/")
def accueil_cm():  # Redirige /ControllerMobile/ vers /ControllerMobile/1 (premier CM par défaut)
	# Redirige /ControllerMobile/ vers /ControllerMobile/1 (premier CM par défaut).
	return redirect(url_for("cm.afficher_page_cm", cm_id=1))


@cm_bp.route("/<int:cm_id>")
def afficher_page_cm(cm_id: int):  # Affiche la page d'interface du contrôleur mobile demandé (GET /ControllerMobile/<id>)
	#
	# Affiche la page d'interface du contrôleur mobile demandé (GET /ControllerMobile/<id>).
	# Synchronise depuis MySQL, redirige vers un ID valide si nécessaire.
	# Passe au template : contamination, bruit de fond, noms de tous les CM, rôle.
	#
	rafraichir_cm_depuis_mysql()
	max_cm = min(lire_limite_reglage_mysql(2, 16), MAX_REGLAGE_CM)

	if cm_id < 1:
		cm_id = 1

	actifs = ids_cm_actifs()
	if not actifs:
		return render_template(
			"cm/CM.html",
			cm_id=0,
			valeur_conta="0",
			valeur_bdf="0",
			cm_names={},
			cm_ids=[],
			max_cm=max_cm,
			role=session.get("role", "user"),
			has_equipment=False,
		)
	if cm_id not in actifs:
		cible = actifs[0]
		return redirect(url_for("cm.afficher_page_cm", cm_id=cible))

	if cm_id in deleted_cm_ids:
		cible = actifs[0] if actifs else 1
		return redirect(url_for("cm.afficher_page_cm", cm_id=cible))

	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()
	last_values_cm[cm_id].setdefault("Status", "0")
	last_values_cm[cm_id].setdefault("NivBruitFond", "1")

	return render_template(
		"cm/CM.html",
		cm_id=cm_id,
		valeur_conta=last_values_cm[cm_id]["NivContamination"],
		valeur_bdf=last_values_cm[cm_id]["NivBruitFond"],
		cm_names=cm_names,
		cm_ids=ids_cm_actifs(),
		max_cm=max_cm,
		role=session.get("role", "user"),
		has_equipment=True,
	)


@cm_bp.route("/slider/<int:cm_id>", methods=["POST"])
def slider_cm(cm_id: int):  # Recoit une valeur de jauge depuis l'interface CM et la publie sur MQTT (POST /ControllerMobile/slider/<id>)
	#
	# Recoit une valeur de jauge depuis l'interface CM et la publie sur MQTT (POST /ControllerMobile/slider/<id>).
	# Champ "type" : "status" (0/1), "bruitfond" ou contamination (défaut).
	# Donne "ok" ou un message d'erreur.
	#
	rafraichir_cm_depuis_mysql()

	if cm_id < 1:
		return "unknown cm_id", 400
	if cm_id not in ids_cm_actifs():
		return "unknown cm_id", 404

	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()
	last_values_cm[cm_id].setdefault("Status", "0")
	last_values_cm[cm_id].setdefault("NivBruitFond", "1")

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
	elif type_norm in ("bruitfond", "bruitdefond", "bruit_fond"):
		last_values_cm[cm_id]["NivBruitFond"] = value
		topic = topic_bruit_fond_cm(cm_id)
		display_type = "BruitFond"
		value_to_publish = value
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
def ajouter_appareil_cm():  # Crée un nouveau contrôleur mobile (POST /ControllerMobile/ajouter-appareil, admin)
	#
	# Crée un nouveau contrôleur mobile (POST /ControllerMobile/ajouter-appareil, admin).
	# Vérifie : nom obligatoire, ID dans les limites, ID non dupliqué.
	# Enregistre en mémoire et MySQL, initialise les valeurs MQTT avec retain.
	# Donne {ok: true, cm_id} ou {ok: false, error}.
	#
	rafraichir_cm_depuis_mysql()
	max_cm = min(lire_limite_reglage_mysql(2, 16), MAX_REGLAGE_CM)

	name = request.form.get("name", "")
	cm_id = lire_id_formulaire()

	if not str(name or "").strip():
		return jsonify(ok=False, error="Le nom est obligatoire."), 400

	if cm_id is None or cm_id < 1 or cm_id > max_cm:
		return jsonify(ok=False, error=f"ID CM invalide (1 a {max_cm})."), 400
	if len(ids_cm_actifs()) >= max_cm:
		return jsonify(ok=False, error=f"Limite CM atteinte ({max_cm})."), 400

	if cm_id in ids_cm_actifs():
		return jsonify(ok=False, error="Cet ID est deja assigne."), 400

	cm_names[cm_id] = str(name).strip()
	deleted_cm_ids.discard(cm_id)
	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()

	sync_ok, sync_err = enregistrer_equipement_mysql(cm_id, cm_names[cm_id], "CM", None)
	if not sync_ok:
		print("MySQL equipements sync error:", sync_err)
		return jsonify(ok=False, error="Erreur MySQL equipements."), 500

	initialiser_mqtt_cm(cm_id)

	print(f"Controller Mobile No{cm_id} a ete cree")
	return jsonify(ok=True, cm_id=cm_id)


@cm_bp.route("/supprimer-appareil", methods=["POST"], endpoint="supprimer_appareil")
@require_admin_role()
def supprimer_appareil_cm():  # Supprime un contrôleur mobile (POST /ControllerMobile/supprimer-appareil, admin)
	#
	# Supprime un contrôleur mobile (POST /ControllerMobile/supprimer-appareil, admin).
	# Nettoie la mémoire, MySQL et les messages MQTT retainés (payload vide sur 3 topics).
	# Donne {ok: true} ou {ok: false, error}.
	#
	rafraichir_cm_depuis_mysql()

	cm_id = lire_id_formulaire()
	if cm_id is None:
		return jsonify(ok=False, error="ID invalide."), 400

	if cm_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	deleted_cm_ids.add(cm_id)
	cm_names.pop(cm_id, None)
	last_values_cm.pop(cm_id, None)

	db_ok, db_err = supprimer_equipement_mysql(cm_id, ("MIP10", "CM", "CONTROLLERMOBILE"))
	if not db_ok:
		print("MySQL equipements delete error:", db_err)
		return jsonify(ok=False, error="Erreur MySQL equipements."), 500

	deconnecter_mqtt_cm(cm_id)

	print(f"Controller Mobile No{cm_id} a ete supprime")
	return jsonify(ok=True)


@cm_bp.route("/state/<int:cm_id>", endpoint="obtenir_etat")
def obtenir_etat_cm(cm_id: int):  # Donne l'état JSON d'un CM (GET /ControllerMobile/state/<id>)
	#
	# Donne l'état JSON d'un CM (GET /ControllerMobile/state/<id>).
	# Utilisé par le polling JavaScript. Donne : {ok, cm_id, NivContamination, NivBruitFond, Status}.
	# Headers no-cache appliqués.
	#
	rafraichir_cm_depuis_mysql()

	if cm_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400
	if cm_id not in ids_cm_actifs():
		return jsonify(ok=False, error="ID inconnu."), 404

	if cm_id not in last_values_cm:
		last_values_cm[cm_id] = entree_par_defaut_cm()

	entry = last_values_cm[cm_id]
	contamination = str(entry.get("NivContamination", "1"))
	bruit_fond = str(entry.get("NivBruitFond", "1"))
	status = "1" if str(entry.get("Status", "0")).strip() == "1" else "0"

	response = jsonify(ok=True, cm_id=cm_id, NivContamination=contamination, NivBruitFond=bruit_fond, Status=status)
	return appliquer_headers_no_cache(response)


# ---------------------------------------------------------------------------
# CPO
# ---------------------------------------------------------------------------
cpo_bp = Blueprint("cpo", __name__, url_prefix="/CPO")

TOPIC_CPO_CONTAMINATION_WILDCARD = "FormaReaEDF/CPO/+/NivContamination"


def entree_par_defaut_cpo():  # Donne les valeurs par défaut d'un CPO : NivContamination=1
	#
	# Donne les valeurs par défaut d'un CPO : NivContamination=1.
	#
	# Valeur par défaut initiale pour un nouveau CPO ou un CPO sans données.
	# Modifier ici si vous souhaitez changer le niveau initial chargé dans l'UI.
	return {"NivContamination": "1"}


def topic_contamination_cpo(cpo_id: int) -> str:  # Génère le topic MQTT de contamination pour un CPO donné : FormaReaEDF/CPO/CPO_{id}/NivContamination
	# Génère le topic MQTT de contamination pour un CPO donné : FormaReaEDF/CPO/CPO_{id}/NivContamination.
	return f"FormaReaEDF/CPO/CPO_{cpo_id}/NivContamination"


last_values_cpo = {}
cpo_names = {}
deleted_cpo_ids: set[int] = set()
mqtt_client_cpo = None


def ids_cpo_actifs() -> list[int]:  # Donne la liste triée des IDs de CPO actifs (non supprimés)
	#
	# Donne la liste triée des IDs de CPO actifs (non supprimés)
	# en se basant sur cpo_names et deleted_cpo_ids.
	#
	return ids_triees(i for i in cpo_names.keys() if i not in deleted_cpo_ids)


def rafraichir_cpo_depuis_mysql():  # Synchronise le dictionnaire cpo_names depuis MySQL (type CPO)
	#
	# Synchronise le dictionnaire cpo_names depuis MySQL (type CPO).
	# Supprime les entrées obsolètes de last_values_cpo. Appelé en début de chaque route CPO.
	#
	if not USE_MYSQL:
		return
	names, _ = lire_equipements_mysql(("CPO",))
	cpo_names.clear()
	cpo_names.update(names)
	deleted_cpo_ids.intersection_update(set(cpo_names.keys()))
	for cpo_id in list(last_values_cpo.keys()):
		if cpo_id not in cpo_names:
			last_values_cpo.pop(cpo_id, None)


def initialiser_mqtt_cpo(cpo_id: int):  # Publie la valeur de contamination actuelle d'un CPO sur MQTT avec retain=True
	#
	# Publie la valeur de contamination actuelle d'un CPO sur MQTT avec retain=True.
	# Appelé à la création d'un CPO ou à la reconnexion du client MQTT.
	#
	if not mqtt_client_cpo:
		return

	mqtt_client_cpo.publish(topic_contamination_cpo(cpo_id), f"{last_values_cpo[cpo_id]['NivContamination']}", retain=True)


def deconnecter_mqtt_cpo(cpo_id: int):  # Efface le message MQTT retainé d'un CPO en publiant un payload vide sur son topic
	#
	# Efface le message MQTT retainé d'un CPO en publiant un payload vide sur son topic.
	# Appelé lors de la suppression d'un CPO pour nettoyer le broker.
	#
	if not mqtt_client_cpo:
		return

	mqtt_client_cpo.publish(topic_contamination_cpo(cpo_id), "", retain=True)


def on_connect_mqtt_cpo(client, userdata, flags, rc):  # Fonction MQTT on_connect pour le module CPO
	#
	# Fonction MQTT on_connect pour le module CPO.
	# S'abonne au topic NivContamination avec wildcard +.
	# Ré-publie les valeurs actuelles de tous les CPO actifs après reconnexion.
	#
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


def traiter_message_mqtt_cpo(client, userdata, msg):  # Fonction MQTT on_message pour le module CPO
	#
	# Fonction MQTT on_message pour le module CPO.
	# Met à jour last_values_cpo[id]["NivContamination"] si le topic reçu
	# correspond à un CPO actif et connu. Ignore les messages mal formés ou obsolètes.
	#
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
def accueil_cpo():  # Redirige /CPO/ vers /CPO/1 (premier CPO par défaut)
	# Redirige /CPO/ vers /CPO/1 (premier CPO par défaut).
	return redirect(url_for("cpo.afficher_page_cpo", cpo_id=1))


@cpo_bp.route("/<int:cpo_id>")
def afficher_page_cpo(cpo_id: int):  # Affiche la page d'interface du CPO demandé (GET /CPO/<id>)
	#
	# Affiche la page d'interface du CPO demandé (GET /CPO/<id>).
	# Synchronise depuis MySQL, redirige vers un ID valide si nécessaire.
	# Passe au template : la valeur de contamination, les noms de tous les CPO, le rôle.
	#
	rafraichir_cpo_depuis_mysql()
	max_cpo = min(lire_limite_reglage_mysql(3, 6), MAX_REGLAGE_CPO)

	if cpo_id < 1:
		cpo_id = 1

	actifs = ids_cpo_actifs()
	if not actifs:
		return render_template(
			"cpo/CPO.html",
			cpo_id=0,
			valeur_conta="0",
			cpo_names={},
			cpo_ids=[],
			max_cpo=max_cpo,
			role=session.get("role", "user"),
			has_equipment=False,
		)
	if cpo_id not in actifs:
		cible = actifs[0]
		return redirect(url_for("cpo.afficher_page_cpo", cpo_id=cible))

	if cpo_id in deleted_cpo_ids:
		cible = actifs[0] if actifs else 1
		return redirect(url_for("cpo.afficher_page_cpo", cpo_id=cible))

	if cpo_id not in last_values_cpo:
		last_values_cpo[cpo_id] = entree_par_defaut_cpo()

	return render_template(
		"cpo/CPO.html",
		cpo_id=cpo_id,
		valeur_conta=last_values_cpo[cpo_id]["NivContamination"],
		cpo_names=cpo_names,
		cpo_ids=ids_cpo_actifs(),
		max_cpo=max_cpo,
		role=session.get("role", "user"),
		has_equipment=True,
	)


@cpo_bp.route("/slider/<int:cpo_id>", methods=["POST"], endpoint="traiter_jauge")
def traiter_jauge_cpo(cpo_id: int):  # Recoit une valeur de jauge depuis l'interface CPO et publie la contamination sur MQTT
	#
	# Recoit une valeur de jauge depuis l'interface CPO et publie la contamination sur MQTT
	# (POST /CPO/slider/<id>). Donne "ok" ou un message d'erreur.
	#
	rafraichir_cpo_depuis_mysql()

	if cpo_id < 1:
		return "unknown cpo_id", 400
	if cpo_id not in ids_cpo_actifs():
		return "unknown cpo_id", 404

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
def ajouter_appareil_cpo():  # Crée un nouveau CPO (POST /CPO/ajouter-appareil, admin uniquement)
	#
	# Crée un nouveau CPO (POST /CPO/ajouter-appareil, admin uniquement).
	# Vérifie : nom obligatoire, ID dans les limites, ID non dupliqué.
	# Enregistre en mémoire et MySQL, initialise la contamination sur MQTT avec retain.
	# Donne {ok: true, cpo_id} ou {ok: false, error}.
	#
	rafraichir_cpo_depuis_mysql()
	max_cpo = min(lire_limite_reglage_mysql(3, 6), MAX_REGLAGE_CPO)

	name = request.form.get("name", "")
	cpo_id = lire_id_formulaire()

	if not str(name or "").strip():
		return jsonify(ok=False, error="Le nom est obligatoire."), 400

	if cpo_id is None or cpo_id < 1 or cpo_id > max_cpo:
		return jsonify(ok=False, error=f"ID CPO invalide (1 a {max_cpo})."), 400
	if len(ids_cpo_actifs()) >= max_cpo:
		return jsonify(ok=False, error=f"Limite CPO atteinte ({max_cpo})."), 400

	if cpo_id in ids_cpo_actifs():
		return jsonify(ok=False, error="Cet ID est deja assigne."), 400

	cpo_names[cpo_id] = str(name).strip()
	deleted_cpo_ids.discard(cpo_id)
	if cpo_id not in last_values_cpo:
		last_values_cpo[cpo_id] = entree_par_defaut_cpo()

	sync_ok, sync_err = enregistrer_equipement_mysql(cpo_id, cpo_names[cpo_id], "CPO", None)
	if not sync_ok:
		print("MySQL equipements sync error:", sync_err)
		return jsonify(ok=False, error="Erreur MySQL equipements."), 500

	initialiser_mqtt_cpo(cpo_id)

	print(f"CPO ID {cpo_id} a ete cree")
	return jsonify(ok=True, cpo_id=cpo_id)


@cpo_bp.route("/supprimer-appareil", methods=["POST"], endpoint="supprimer_appareil")
@require_admin_role()
def supprimer_appareil_cpo():  # Supprime un CPO (POST /CPO/supprimer-appareil, admin uniquement)
	#
	# Supprime un CPO (POST /CPO/supprimer-appareil, admin uniquement).
	# Nettoie la mémoire, MySQL et le message MQTT retainé (payload vide).
	# Donne {ok: true} ou {ok: false, error}.
	#
	rafraichir_cpo_depuis_mysql()

	cpo_id = lire_id_formulaire()
	if cpo_id is None:
		return jsonify(ok=False, error="ID invalide."), 400

	if cpo_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400

	deleted_cpo_ids.add(cpo_id)
	cpo_names.pop(cpo_id, None)
	last_values_cpo.pop(cpo_id, None)

	db_ok, db_err = supprimer_equipement_mysql(cpo_id, "CPO")
	if not db_ok:
		print("MySQL equipements delete error:", db_err)
		return jsonify(ok=False, error="Erreur MySQL equipements."), 500

	deconnecter_mqtt_cpo(cpo_id)

	print(f"CPO ID {cpo_id} a ete supprime")
	return jsonify(ok=True)


@cpo_bp.route("/state/<int:cpo_id>", endpoint="obtenir_etat")
def obtenir_etat_cpo(cpo_id: int):  # Donne l'état JSON d'un CPO (GET /CPO/state/<id>)
	#
	# Donne l'état JSON d'un CPO (GET /CPO/state/<id>).
	# Utilisé par le polling JavaScript. Donne : {ok, cpo_id, NivContamination}.
	# Headers no-cache appliqués.
	#
	rafraichir_cpo_depuis_mysql()

	if cpo_id < 1:
		return jsonify(ok=False, error="ID invalide."), 400
	if cpo_id not in ids_cpo_actifs():
		return jsonify(ok=False, error="ID inconnu."), 404

	if cpo_id not in last_values_cpo:
		last_values_cpo[cpo_id] = entree_par_defaut_cpo()

	entry = last_values_cpo[cpo_id]
	contamination = str(entry.get("NivContamination", "1"))

	response = jsonify(ok=True, cpo_id=cpo_id, NivContamination=contamination)
	return appliquer_headers_no_cache(response)


logging.getLogger("werkzeug").setLevel(logging.ERROR)
