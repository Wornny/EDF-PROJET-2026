# Serveur MQTT pour l'initialisateur.
# Gère les publications et abonnements nécessaires à l'initialisation des badges et dosimètres.

import random
import json
import mysql.connector
from paho.mqtt import client as mqtt_client
from datetime import date
import time 
import os
import configparser
import logging
from interfacebdd import InterfaceBDD


class Mqttserver:

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

    _cfg = configparser.ConfigParser()
    _cfg.read(os.path.join(BASE_DIR, ".conf"), encoding="utf-8")

    log_enabled = _cfg.getboolean("logging", "ENABLED")
    log_level = _cfg.get("logging", "LEVEL")
    log_file = _cfg.get("logging", "FILE")

    logger = logging.getLogger("mqtt")
    logger.setLevel(getattr(logging, log_level))

    if log_enabled:
        handler = logging.FileHandler(log_file)
        formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    NUMERO_INITIALISATEUR = _cfg.getint("mqtt", "NUMERO_INITIALISATEUR")
    BROKER = os.environ.get("BROKER_HOST", _cfg.get("mqtt", "IP_MQTT"))
    PORT = int(os.environ.get("BROKER_PORT", _cfg.get("mqtt", "PORT_MQTT")))
    TOPIC_DOSI = f"FormaReaEDF/initialisateur/{NUMERO_INITIALISATEUR}/dosi/id"
    TOPIC_BADGE = f"FormaReaEDF/initialisateur/{NUMERO_INITIALISATEUR}/badge/id"
    TOPIC_ATTESTATION = f"FormaReaEDF/initialisateur/{NUMERO_INITIALISATEUR}/attestation/id"

    TOPIC_DOSI_ACCES = f"FormaReaEDF/initialisateur/{NUMERO_INITIALISATEUR}/dosi/acces"
    TOPIC_BADGE_ACCES = f"FormaReaEDF/initialisateur/{NUMERO_INITIALISATEUR}/badge/acces"
    TOPIC_ATTESTATION_ACCES = f"FormaReaEDF/initialisateur/{NUMERO_INITIALISATEUR}/attestation/acces"
    USERNAME = os.environ.get("MQTT_USERNAME", _cfg.get("mqtt", "LOGIN_MQTT"))
    PASSWORD = os.environ.get("MQTT_PASSWORD", _cfg.get("mqtt", "MDP_MQTT"))

    def __init__(self,controller):
        self.client_id = f'Initialisateur-{random.randint(0, 1000)}'
        self.client = mqtt_client.Client(client_id=self.client_id)
        self.client.username_pw_set(self.USERNAME, self.PASSWORD)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message   
        self.InterfaceBDD = InterfaceBDD()
        self.controller = controller

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.logger.info("Connecté au broker MQTT !")
            client.subscribe(self.TOPIC_DOSI)
            client.subscribe(self.TOPIC_BADGE)
            client.subscribe(self.TOPIC_ATTESTATION)

    def on_message(self, client, userdata, msg):
        if msg.topic == self.TOPIC_DOSI:
            payload = msg.payload.decode()
            data = json.loads(payload)
            self.dernier_dosi = data
            self.logger.info("id DOSI recu : %s", data)           
            self.controller.getEtatDosimetre(data)


        elif msg.topic == self.TOPIC_BADGE:
            payload = msg.payload.decode()
            data = json.loads(payload)
            self.dernier_badge = data
            self.logger.info("id BADGE recu : %s", data)           
            self.controller.getEtatBadge(data)    

        elif msg.topic == self.TOPIC_ATTESTATION:
            payload = msg.payload.decode()
            data = json.loads(payload)
            self.dernier_attestation = data
            self.logger.info("id attestation recu : %s", data)   
            self.controller.getEtatAttestation(data) 

    def connecter_mqtt(self):
        self.client.connect(self.BROKER, self.PORT)
        self.client.loop_start()

    def deconnecter_mqtt(self):
        self.client.disconnect()
        self.client.loop_stop()


    def Envoyer_Dosi_acces(self, acces_dosi):
        return self.client.publish(self.TOPIC_DOSI_ACCES, json.dumps(acces_dosi, ensure_ascii=False),qos= 1, retain=False)
    
    def Envoyer_Badge_acces(self, acces_badge):
        return self.client.publish(self.TOPIC_BADGE_ACCES, json.dumps(acces_badge, ensure_ascii=False),qos= 1, retain=False)
    
    def Envoyer_Attestation_acces(self, acces_attestation):
        return self.client.publish(self.TOPIC_ATTESTATION_ACCES, json.dumps(acces_attestation, ensure_ascii=False),qos= 1, retain=False)