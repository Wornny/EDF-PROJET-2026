import paho.mqtt.client as mqtt
import json
import time

class Controller: 

    BROKER = "192.168.190.31"
    PORT = 1883

    TOPIC_LOGIN = "FormaReaEDF/login"
    TOPIC_RESPONSE = "FormaReaEDF/login/response"

    def __init__(self):
        self.client = mqtt.Client()
        self.client.on_message = self.on_message
        self.client.connect(self.BROKER, self.PORT)
        self.client.subscribe(self.TOPIC_RESPONSE)
        self.client.loop_start()
        self.response = None

    def login(self, username, password):
        payload = json.dumps({
            "username": username,
            "password": password
        })

        print("Publie :", payload)  # debug

        self.response = None
        self.client.publish(self.TOPIC_LOGIN, payload)

        timeout = time.time() + 5
        while self.response is None:
            if time.time() > timeout:
                return False
            time.sleep(0.1)

        if self.response.get("status") == "ok":
            return self.response.get("role")

        return False

    def on_message(self, client, userdata, msg):
        self.response = json.loads(msg.payload.decode())

