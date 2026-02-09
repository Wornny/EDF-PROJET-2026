import os

from flask import Flask, Response, redirect, send_from_directory

BASE_DIR = os.path.dirname(__file__)
PAGE_ACCUEIL_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "page d'accueil"))
TEMPLATE_DIR = os.path.join(PAGE_ACCUEIL_DIR, "templates")
STATIC_DIR = os.path.join(PAGE_ACCUEIL_DIR, "static")

app = Flask(__name__, static_folder=None)


def _menu_html():
	menu_path = os.path.join(TEMPLATE_DIR, "menu.html")
	with open(menu_path, "r", encoding="utf-8") as f:
		html = f.read()

	inject = """
<script>
  document.addEventListener('click', function (e) {
	var device = e.target.closest('.device');
	if (!device) return;
	if (!device.classList.contains('active')) return;

	var label = device.dataset.label || '';
	if (label === 'CPO') window.location.href = '/CPO/1';
	if (label === 'Controleur mobile') window.location.href = '/ControllerMobile/1';
  });
</script>
"""

	if "</body>" in html:
		html = html.replace("</body>", inject + "\n</body>")
	else:
		html += inject

	return html


@app.route("/")
def menu():
	return Response(_menu_html(), mimetype="text/html")


@app.route("/static/<path:filename>")
def static_files(filename):
	return send_from_directory(STATIC_DIR, filename)


@app.route("/CPO")
def cpo_root():
	return redirect("http://localhost:5001/CPO/1")


@app.route("/CPO/<path:subpath>")
def cpo_proxy(subpath):
	return redirect(f"http://localhost:5001/CPO/{subpath}")


@app.route("/ControllerMobile")
def cm_root():
	return redirect("http://localhost:5000/ControllerMobile/1")


@app.route("/ControllerMobile/<path:subpath>")
def cm_proxy(subpath):
	return redirect(f"http://localhost:5000/ControllerMobile/{subpath}")


if __name__ == "__main__":
	app.run(host="0.0.0.0", port=5002, debug=True)
