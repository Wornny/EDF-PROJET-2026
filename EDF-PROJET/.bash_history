apt update
sudo apt install ca-certificates curl gnupg lsb-release -y
apt install docker.io docker-compose -y
apt update
apt install sudo -y
usermod -aG sudo utilisateur
docker network create broker-network
ls
ls
ls al
ls-al
mkdir broker
ls
mkdir bdd
ls
mkdir portnair
rm portnair/
rm-r portnair/
rmdir portnair/
mkdir portainer
cd portainer/
touch docker-compose.yml
nano docker-compose.yml 
nano docker-compose.yml 
cd ..
cd broker/
touch docker-compose.yml
nano docker-compose.yml 
cd..
cd ..
cd bdd
touch docker-compose.yml
nano docker-compose.yml 
cd ..
ls
cd b
cd broker/
nano docker-compose.yml 
mkdir mosquitto
cd mosquitto/
mkdir config
cd config/
mkdir certs
touch passwd
touch mosquitto.conf
nano mosquitto.conf 
cd ..
cd ..
cd ..
cd portainer/
nano docker-compose.yml 
docker compose up -d
docker compose up -d
docker compose up 
ls
docker-compose up 
docker compose up -d
docker-compose up -d
cd ..
cd broker/
ls
nano docker-compose.yml 
cd mosquitto/
cd config/
cd certs/
openssl req -x509 -nodes -days 18250 \
rm mosquitto.crt mosquitto.key
ls
rm privkey.pem 
openssl req -x509 -nodes -days 18250 -newkey rsa:2048 -keyout mosquitto.key -out mosquitto.crt -subj "/CN=mqtt-broker"
ls
cd ..
nano mosquitto.conf 
ls
cd certs/
ls
openssl genrsa -out server.key 2048
# Générer la requête de signature (CSR)
openssl req -new -key server.key -out server.csr -subj "/CN=mqtt-broker"
# Signer le certificat serveur avec la CA
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 18250 -sha256
ls
openssl genrsa -out client1.key 2048
# Générer la requête de signature (CSR)
openssl req -new -key client1.key -out client1.csr -subj "/CN=client1"
# Signer le certificat client avec la CA
openssl x509 -req -in client1.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client1.crt -days 18250 -sha256
cd ..
nano mosquitto.conf 
cd ..
cd ..
ls
docker-compose up -d
cd ..
cd bdd/
nano docker-compose.yml 
docker-compose up -d
 cd ..
mkdir app
cd app
touch docker-compose.yml
nano docker-compose.yml 
docker compose up -d
docker-compose up -d
cd ..
docker ps
CONTAINER ID   IMAGE                           COMMAND                  CREATED              STATUS                          PORTS                                                                                            NAMES
72a741066951   mysql:8.1                       "docker-entrypoint.s…"   About a minute ago   Up About a minute               0.0.0.0:3306->3306/tcp, :::3306->3306/tcp, 33060/tcp                                             mysql-db
cb2185bc466e   eclipse-mosquitto:2.0           "/docker-entrypoint.…"   11 minutes ago       Restarting (3) 54 seconds ago                                                                                                    broker-mqtt
a7e2c2b2dd82   portainer/portainer-ce:latest   "/portainer"             34 minutes ago       Up 30 minutes                   0.0.0.0:8000->8000/tcp, :::8000->8000/tcp, 0.0.0.0:9443->9443/tcp, :::9443->9443/tcp, 9000/tcp   portainer
root@serveur-debian:~# ^C
root@serveur-debian:~# ^C
root@serveur-debian:~#
cd broker/
cd config/
ls
cd ..
ls
cd mosquitto/
cd
xs
cd
cd ..
ls
cd /root/broker/mosquitto
ls
cd config/
ls
cd certs/
ls
cd ..
ls
nano mosquitto.conf 
ls
cd ..
ls
cd config/
ls
dc ..
cd ..
cd ..
ls
nano docker-compose.yml 
cd mosquitto/
cd config/
cd certs/
ls
rm client1.csr 
rm client1.key 
rm mosquitto.crt 
rm mosquitto.key 
rm server.csr 
rm server.key 
ls
# Clé privée CA
openssl genrsa -out ca.key 4096
# Certificat CA auto-signé 50 ans
openssl req -x509 -new -nodes -key ca.key -sha256 -days 18250 -out ca.crt -subj "/CN=MyMQTT-CA"
ls
# Clé privée serveur
openssl genrsa -out server.key 2048
# CSR serveur
openssl req -new -key server.key -out server.csr -subj "/CN=mqtt-broker"
# Signer avec la CA
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 18250 -sha256
# Clé privée client
openssl genrsa -out client1.key 2048
# CSR client
openssl req -new -key client1.key -out client1.csr -subj "/CN=client1"
# Signer avec la CA
openssl x509 -req -in client1.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client1.crt -days 18250 -sha256
chmod 600 *.key
chmod 644 *.crt
cd ..
cd ..
cd ..
docker-compose up -d
# Signer avec la CA
docker ps
ls
cd config/
ls
cd ..
cd mosquitto/
ls
cd config/
ls
nano mosquitto.conf 
docker logs -f broker-mqtt
cd ..
cd ..
docker logs -f broker-mqtt
docker-compose down
docker-compose up -d
docker ps
ls
nano docker-compose.yml 
ls
cd mosquitto/
d ..
cd ..
mv docker-compose.yml 
mv docker-compose.yml mosquitto/
ls
rm r config/
rm -r config/
ls
cd mosquitto/
docker-compose down
docker-compose up -d
docker ps -a
docker rm -f broker-mqtt
docker-compose up -d
docker ps
ip a
cd ..
cd ..
docker restart portainer
ls
cd bdd
ls
nano docker-compose.yml 
cd ..
docker network ls
cd broker/
cd mosquitto/
ls
cd config/
ls
nano mosquitto.conf 
cd certs/
ls
rm client1.csr 
rm client1.crt 
rm client1.key 
ls
openssl req -new -nodes -out client1.csr -newkey rsa:2048 -keyout client1.key -subj "/CN=user"
openssl x509 -req -in client1.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client1.crt -days 3650
ls
cd ..
ls
d passwd 
mosquitto_passwd -b /mosquitto/config/passwd client normandie765
ls
apt update
apt install -y mosquitto mosquitto-clients
mosquitto_passwd -b /root/broker/mosquitto/config/passwd client normandie765
docker-compose restart broker-mqtt
docker ps
cd ..
cd ..
docker-compose restart broker-mqtt
cd mosquitto/
docker-compose restart broker-mqtt
root@serveur-debian:~/broker# docker-compose restart broker-mqtt
ERROR:
        Can't find a suitable configuration file in this directory or any
        parent. Are you in the right directory?

        Supported filenames: docker-compose.yml, docker-compose.yaml, compose.yml, compose.yaml

root@serveur-debian:~/broker#

docker-compose restart




exit
docker-compose restart mqtt
docker ps
docker-compose restart mqtt
cd ..
cd ..
mysql -h 127.0.0.1 -P 3306 -u admin -p
apt update
apt install -y mysql-client
mysql -h 127.0.0.1 -P 3306 -u admin -p
mysql -h 127.0.0.1 -P 3306 -u user -p
nano /etc/network/interfaces
nano /etc/network/interfaces
inet 192.168.190.50/23
-bash: inet : commande introuvable
root@serveur-debian:ping 192.168.191.254
ping 192.168.191.254
ping 192.168.190.50
iptables -L
nft list ruleset
nft list ruleset
nano /etc/network/interfaces
ufw disable
iptables -L -n -v
ip a
nano /etc/network/interfaces
sudo systemctl restart networking
docker exec -it mysql-db mysql -uroot -p
docker exec -it mysql-db mysql -uroot -p
docker exec -it mysql-db mysql -uroot -p
docker exec -it mysql-db mysql -uroot -p
Enter password:
ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: YES)
root@serveur-debian:~#
docker exec -it mysql-db mysql -uadmin -p
docker exec -it mysql-db mysql -uadmin -p
docker exec -it mysql-db mysql -uuser -p
ls
cd bdd
ls
nano docker-compose.yml 
docker-compose down
docker-compose up -d
mysql -uuser -p -h 127.0.0.1
cd ..
mysql -uuser -p -h 127.0.0.1
mysql -uuser -p -h 127.0.0.1
apt update
apt install mysql-client -y
docker exec -it mysql-db mysql -uuser -p
docker exec -it mysql-db mysql -uroot -p
docker exec -it mysql-db mysql -uroot -p
docker exec -it mysql-db mysql -uroot -p
docker exec -it mysql-db bash
cd bdd
nano docker-compose.yml 
docker-compose down
docker-compose up -d
sudo lsmod | grep nat
sudo modprobe iptable_nat
sudo modprobe ipt_MASQUERADE
sudo update-alternatives --config iptables
sudo update-alternatives --config ip6tables
sudo systemctl restart docker
docker-compose down
docker-compose up -d
docker exec -it mysql-db bash
docker-compose down
docker run --rm -it   -e MYSQL_ROOT_PASSWORD=superbddnormandie765   --name mysql-temp   -v $(pwd)/mysql_data:/var/lib/mysql   mysql:8.1   --skip-grant-tables
docker exec -it mysql-db bash
mysql -u root
docker-compose up -d
docker exec -it mysql-db mysql -u root -p
docker-compose down
docker run --rm -it   -e MYSQL_ROOT_PASSWORD=superbddnormandie765   --name mysql-temp   -v $(pwd)/mysql_data:/var/lib/mysql   mysql:8.1   --skip-grant-tables
docker exec -it mysql-db mysql -uroot -p
ls
cd bdd
nano docker-compose.yml 
ping 192.168.190.50
ip route add default via 192.168.191.254
ping 192.168.191.254
ping 192.168.190.254
ping 192.168.191.254
nft list ruleset
nft flush ruleset
ping 192.168.190.50
nano /etc/network/interfaces
sudo ifdown enp1s0 && sudo ifu^p enp1s0
sudo ifdown enp1s0 && sudo ifup enp1s0
ip a
 
docker rm -f mysql-db
docker ps
cd bdd
docker-compose down
docker ps -a
docker rm -f mysql-db
nano docker-compose.yml 
docker-compose up -d
docker exec -it mysql-db mysql -u root -p
docker-compose down
docker volume ls
docker volume rm bdd_mysql_data
docker-compose up -d
docker exec -it mysql-db mysql -u root -p
docker exec -it mysql-db mysql -u root -p
docker exec -it mysql-db 
docker exec -it mysql-db mysql -u root -p
docker exec -it mysql-db mysql -u root@% -p
nano docker-compose.yml 
nano docker-compose.yml 
docker exec -it mysql-db mysql -u root@% -p
docker exec -it mysql-db mysql -u root@% -p
nano docker-compose.yml 
docker exec -it mysql-db mysql -u root@% -p
docker exec -it mysql-db mysql -u root -p
nano docker-compose.yml 
docker-compose down
docker-compose up -d
docker exec -it mysql-db mysql -u root -p
docker exec -it mysql-db mysql -u root -p
docker exec -it bdd mysql -u root -p
docker exec -it mysql-db mysql -u root -p
docker exec -it mysql-db
docker ps -a
docker ps -a
nano docker-compose.yml 
docker-compose up -d
docker exec -it mysql-db mysql -u root -p
nano docker-compose.yml 
docker exec -it mysql-db mysql -u root -p
