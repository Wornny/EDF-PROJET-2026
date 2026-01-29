from flask import Flask, render_template, request, jsonify, redirect
import paho.mqtt.client as mqtt
import json

MQTT_BROKER = "192.168.190.31"
MQTT_PORT = 1883

app = Flask(__name__)

mqtt_client = mqtt.Client()
mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
mqtt_client.loop_start()


@app.route("/")
def root():
    return redirect("/C2/1")

@app.route("/C2")
def c2_root():
    return redirect("/C2/1")

@app.route("/C2/<int:c2_id>")
def c2_page(c2_id: int):
    return render_template("C2.html", c2_id=c2_id)



@app.route("/publish_capteurs_full", methods=["POST"])
def publish_capteurs_full():
    data = request.get_json()
    c2_id = data.get("c2_id", "C2_1")

    capteurs = data.get("capteurs", {})

    topic = f"FormaReaEDF/C2/{c2_id}/Capteurs"
    payload = {
        "c2_id": c2_id,
        "capteurs": capteurs
    }

    mqtt_client.publish(topic, json.dumps(payload), retain=True)
    return jsonify({"status": "ok"}), 200



if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
