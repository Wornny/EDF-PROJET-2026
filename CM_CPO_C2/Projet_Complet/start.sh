#!/usr/bin/env bash
# ----------------------------------------------------------
# Script de demarrage automatique de l'application Flask.
# Il suffit de lancer :  ./start.sh
# ----------------------------------------------------------

set -e

# Se placer dans le repertoire de l'application
cd /home/utilisateur/EDF-Projet/web/app/

# 1. Creer le venv s'il n'existe pas encore
if [ ! -d "venv" ]; then
    echo "[*] Creation de l'environnement virtuel..."
    python3 -m venv venv
fi

# 2. Activer le venv
source venv/bin/activate

# 3. Installer / mettre a jour les dependances si requirements.txt a change
# On compare un fichier temoin (.deps_installed) avec requirements.txt
REQUIREMENTS="requirements/requirements.txt"
STAMP=".deps_installed"

if [ ! -f "$STAMP" ] || ! diff -q "$REQUIREMENTS" "$STAMP" > /dev/null 2>&1; then
    echo "[*] Installation des dependances..."
    pip install --upgrade pip --quiet
    pip install -r "$REQUIREMENTS" --quiet
    cp "$REQUIREMENTS" "$STAMP"
    echo "[*] Dependances installees."
fi

# 4. Lancer l'application
echo "[*] Demarrage de l'application..."
python3 app.py
