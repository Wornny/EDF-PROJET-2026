@echo off
del cert.pem
del key.pem
timeout 2
cls
"C:\Python313\python.exe" "C:\Users\ruettec\Desktop\appli web\BACKUP\generate_cert.py"
cls
timeout 2