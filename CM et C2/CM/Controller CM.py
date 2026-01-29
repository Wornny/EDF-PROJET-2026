from flask import Flask, request, render_template, redirect
import logging



# ===================== RÉGLAGES =====================
# Permet d'activer ou non MQTT
# (False chez moi, True au lycée)
USE_MQTT = True

if USE_MQTT:
    import paho.mqtt.client as mqtt

    # Adresse du broker MQTT
    BROKER_HOST = "192.168.190.31"
    BROKER_PORT = 1883

    # Nouveau format de topic MQTT
    # CM_01, CM_02, ..., CM_11 (pour qu'ils soient bien rangés)
    TOPIC_TEMPLATE_NEW = "FormaReaEDF/CapteurMobile/CM_{cm_id:02d}/NivContamination"

    # Ancien format de topic (utilisé pour supprimer les anciens)
    TOPIC_TEMPLATE_OLD = "FormaReaEDF/CapteurMobile/CM_{cm_id}/NivContamination"




# ===================== FLASK =====================
# Création de l'application Flask
app = Flask(__name__)

# Désactive les messages Flask inutiles dans la console
logging.getLogger("werkzeug").setLevel(logging.ERROR)

# Dictionnaire qui stocke la dernière valeur
# pour chaque capteur mobile (CM 1 à CM 11)
last_values = {i: "0.00" for i in range(1, 12)}




# ===================== MQTT =====================
mqtt_client = None
if USE_MQTT:
    # Création du client MQTT
    mqtt_client = mqtt.Client(client_id="IHM_CM")

    # Connexion au broker MQTT
    mqtt_client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)

    # Démarrage de MQTT en arrière-plan
    mqtt_client.loop_start()

    # 1) Supprime les anciens topics MQTT (CM_1, CM_2, ...)
    # Envoyer un message vide avec retain=True les efface
    for cm_id in range(1, 12):
        old_topic = TOPIC_TEMPLATE_OLD.format(cm_id=cm_id)
        mqtt_client.publish(old_topic, payload="", retain=True)

    # 2) Envoie les valeurs avec le nouveau format (CM_01 à CM_11)
    # et avec l’unité Bq/cm²
    for cm_id, value in last_values.items():
        new_topic = TOPIC_TEMPLATE_NEW.format(cm_id=cm_id)
        mqtt_client.publish(new_topic, f"{value} Bq/cm²", retain=True)




# ===================== PAGES =====================

@app.route("/")
def root():
    """
    Quand on arrive sur le site,
    on va automatiquement sur le CM 1
    """
    return redirect("/CapteurMobile/1")


@app.route("/CapteurMobile")
def capteurmobile():
    """
    Si quelqu’un va sur /CapteurMobile,
    on l’envoie aussi vers le CM 1
    """
    return redirect("/CapteurMobile/1")


@app.route("/CapteurMobile/<int:cm_id>")   # Affiche bien la pa ge CM ID demandée
def page_cm(cm_id: int):
    """

    cm_id vient directement de l’URL
    Exemple : /CapteurMobile/3 → cm_id = 3
    """
    # Si le CM n’existe pas, on revient au CM 1
    if cm_id not in last_values:
        cm_id = 1

    # On envoie au HTML :
    # - le numéro du CM
    # - la dernière valeur enregistrée
    return render_template(
        "InterfaceGraphique_CM.html",
        cm_id=cm_id,
        valeur_init=last_values[cm_id]
    )


@app.route("/slider/<int:cm_id>", methods=["POST"])
def slider(cm_id: int):
    """
    Reçoit la valeur envoyée par la jauge

    Cette fonction est appelée quand
    on bouge ou clique sur la jauge
    """
    # Vérifie que le CM existe
    if cm_id not in last_values:
        return "unknown cm_id", 400

    # Récupération des données envoyées par le JavaScript
    value = request.form.get("value")
    type_ = request.form.get("type")
    equip = request.form.get("equip")

    # On sauvegarde la nouvelle valeur
    if value is not None:
        last_values[cm_id] = value

    # Affiche la valeur dans la console
    print(equip, "=", value, "Bq/cm²")

    # Envoie la valeur sur MQTT
    if USE_MQTT and mqtt_client:
        topic = TOPIC_TEMPLATE_NEW.format(cm_id=cm_id)
        mqtt_client.publish(topic, f"{value} Bq/cm²", retain=True)

    return "ok"



# ===================== LANCEMENT =====================
if __name__ == "__main__":
    """
    Lance le serveur Flask
    Accessible sur le réseau en port 5000
    """
    app.run(host="0.0.0.0", port=5000, debug=True)
