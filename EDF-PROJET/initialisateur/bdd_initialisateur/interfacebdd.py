# Interface vers la base de données pour l'initialisateur.
# Définit les accès et les requêtes vers MySQL.

import random
import json
import mysql.connector
from paho.mqtt import client as mqtt_client
from datetime import date
import time  
import os
import configparser

# Connexion MySQL

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

_cfg = configparser.ConfigParser()
_cfg.read(os.path.join(BASE_DIR, ".conf"), encoding="utf-8")

MYSQL_HOST     = os.environ.get("MYSQL_HOST",     _cfg.get("mysql", "IP_BDD"))
MYSQL_PORT     = int(os.environ.get("MYSQL_PORT",  _cfg.get("mysql", "PORT_BDD")))
MYSQL_USER     = os.environ.get("MYSQL_USER",     _cfg.get("mysql", "LOGIN_BDD"))
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", _cfg.get("mysql", "MDP_BDD"))
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", _cfg.get("mysql", "NOM_BDD"))

class InterfaceBDD:

    def connecter_bdd(self):
        self.mydb = mysql.connector.connect(
            host=MYSQL_HOST,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            port=MYSQL_PORT,
            database=MYSQL_DATABASE
        )


    def deconnecter_bdd(self):
        self.mydb.close()
    
    def Obtenir_Dosi(self, id_dosi):
        self.connecter_bdd()
        mycursor = self.mydb.cursor()
        sql = f"SELECT * FROM init_dosi WHERE id_dosi = %s"
        val = [id_dosi]
        mycursor.execute(sql, val)
        message = mycursor.fetchall()
        mycursor.close()
        self.deconnecter_bdd()
        return message
    
    def Obtenir_Badge(self, id_badge):
        self.connecter_bdd()
        mycursor = self.mydb.cursor()
        sql = f"SELECT * FROM init_badge WHERE id_badge = %s"
        val = [id_badge]
        mycursor.execute(sql, val)
        message = mycursor.fetchall()
        mycursor.close()
        self.deconnecter_bdd()
        return message
    
    def Obtenir_Attestation(self, id_attestation):
        self.connecter_bdd()
        mycursor = self.mydb.cursor()
        sql = f"SELECT * FROM init_attestation WHERE id_attestation = %s"
        val = [id_attestation]
        mycursor.execute(sql, val)
        message = mycursor.fetchall()
        if message :
            message = message[0]
        else :
            message = 0
        mycursor.close()
        self.deconnecter_bdd()
        return message