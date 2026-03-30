from app import create_app

app = create_app()
client = app.test_client()

with client.session_transaction() as session:
    session["is_authenticated"] = True

for url in [
    "/initialisateur/",
    "/initialisateur/index.html",
    "/initialisateur/Badge.html",
    "/initialisateur/css/styles.css",
    "/initialisateur/js/app.js",
]:
    response = client.get(url)
    print(url, response.status_code, response.content_type)
