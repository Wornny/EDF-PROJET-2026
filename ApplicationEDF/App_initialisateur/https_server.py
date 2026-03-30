import http.server
import ssl
import os

PORT = 8443

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

httpd = http.server.HTTPServer(("0.0.0.0", PORT), http.server.SimpleHTTPRequestHandler)

context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(
    certfile=os.path.join(BASE_DIR, "cert.pem"),
    keyfile=os.path.join(BASE_DIR, "key.pem")
)

httpd.socket = context.wrap_socket(httpd.socket, server_side=True)


httpd.serve_forever()