# Contrôleur du module initialisateur.
# Contient la logique d'initialisation et de communication avec MQTT/MySQL.

from mqttserver import Mqttserver
from interfacebdd import InterfaceBDD
import time
import os
import configparser
import logging

class Controler:

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

    _cfg = configparser.ConfigParser()
    _cfg.read(os.path.join(BASE_DIR, ".conf"), encoding="utf-8")

    log_enabled = _cfg.getboolean("logging", "ENABLED")
    log_level = _cfg.get("logging", "LEVEL")
    log_file = _cfg.get("logging", "FILE")

    logger = logging.getLogger("controller")
    logger.setLevel(getattr(logging, log_level))

    if log_enabled:
        handler = logging.FileHandler(log_file)
        formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    def __init__(self):
        self.interfacebdd = InterfaceBDD()
        self.mqtt = Mqttserver(self)
        self.mqtt.connecter_mqtt()

    def getEtatDosimetre(self, data):
        id_dosi = data['id_dosi']
        etat = self.interfacebdd.Obtenir_Dosi(id_dosi)
        
        if  not etat :
            self.logger.info("Dosimètre non present dans la bdd")
            acces_dosi = {"id_dosi": id_dosi,"batterie": 2,"hors_service": 2}
            self.mqtt.Envoyer_Dosi_acces(acces_dosi)
            return 
        

        ligne = etat[0]
        acces_dosi = {"id_dosi": ligne[0],"batterie": ligne[1],"hors_service": ligne[2]}

        self.mqtt.Envoyer_Dosi_acces(acces_dosi)
        self.logger.info(f"etat du dosimètre envoye : {acces_dosi}")


    def getEtatBadge(self, data):
        id_badge = data['id_badge']
        etat = self.interfacebdd.Obtenir_Badge(id_badge)
        
        if  not etat :
            self.logger.info("Badge non present dans la bdd")
            acces_badge = {"id_badge": id_badge,"formation": 2,"visite_medicale": 2}
            self.mqtt.Envoyer_Badge_acces(acces_badge)
            return 
        

        ligne = etat[0]
        acces_badge = {"id_badge": ligne[0],"formation": ligne[1],"visite_medicale": ligne[2]}

        self.mqtt.Envoyer_Badge_acces(acces_badge)
        self.logger.info(f"etat du badge envoye : {acces_badge}")

    def getEtatAttestation(self, data):
        id_attestation = data['id_attestation']
        attestion = self.interfacebdd.Obtenir_Attestation(id_attestation)
        
        if  not attestion :
            self.logger.info("Attestation non presente dans la bdd")
            acces_attestation = {"id_attestation": id_attestation,"date_valide": 2,"zone_valide": 2}
            self.mqtt.Envoyer_Attestation_acces(acces_attestation)
            return 

        acces_attestation = {"id_attestation": attestion[0],"date_valide": attestion[1],"zone_valide": attestion[2]}

        self.mqtt.Envoyer_Attestation_acces(acces_attestation)
        self.logger.info(f"etat de l'attestation envoye : {acces_attestation}")

controler = Controler()

while True : 
    None
