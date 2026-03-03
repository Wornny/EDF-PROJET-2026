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
    # on reçoit maintenant { "c2_id": "C2_1", "F": [...], "D": [...] }
    c2_id = data.get("c2_id", "C2_1")

    f_list = data.get("F", []) or []
    d_list = data.get("D", []) or []

    # sujet MQTT avec l'identifiant du C2, compatible avec FormaReaEDF/C2/+/Capteurs
    topic = f"FormaReaEDF/C2/{c2_id}/Capteurs"

    # construire un payload texte du type {"F":[1; 2; 3], "D":[]}
    def format_array(values):
        if not values:
            return "[]"
        # join avec des '; ' comme séparateur
        joined = "; ".join(str(int(v)) for v in values)
        return f"[{joined}]"

    payload = f'{{"F": {format_array(f_list)}, "D": {format_array(d_list)}}}'

    mqtt_client.publish(topic, payload, retain=True)
    return jsonify({"status": "ok"}), 200



if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
