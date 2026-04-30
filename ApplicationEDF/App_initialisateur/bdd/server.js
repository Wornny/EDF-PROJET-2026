const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const path = require('path');
const mqtt = require('mqtt');

const app = express();
app.use(cors({
  origin: [
    'http://192.168.191.14:3000',
    'http://192.168.191.14:55001',
    'http://192.168.191.14:3000',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));


function normalizeCode(code) {
  const c = String(code).trim();
  return (c.length === 13 && c.startsWith('0')) ? c.slice(1) : c;
}

/* ======================================= MQTT DIRECT ======================================= */
const mqttClient = mqtt.connect('mqtt://192.168.10.3:1883', {
  username: 'client',
  password: 'normandie765',
  keepalive: 30,
  reconnectPeriod: 3000,
});

mqttClient.on('connect',   () => console.log('✅ MQTT connecté'));
mqttClient.on('reconnect', () => console.log('🔄 MQTT reconnexion…'));
mqttClient.on('close',     () => console.log('❌ MQTT déconnecté'));
mqttClient.on('error',     e  => console.warn('⚠️ MQTT erreur:', e?.message || e));

function mqttPublish(topic, payload) {
  return new Promise((resolve, reject) => {
    if (!mqttClient || !mqttClient.connected) return reject(new Error('MQTT non connecté'));
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 0, retain: false }, (err) => {
      if (err) return reject(err);
      console.log('✅ MQTT publié →', topic, payload);
      resolve();
    });
  });
}

/* ======================================= ROUTES MQTT ======================================= */
app.post('/api/mqtt/attestation', async (req, res) => {
  const { code, date_valide, zone_valide, prefix = 'initialisateur1' } = req.body;
  if (!code) return res.status(400).json({ error: 'code requis' });
  const safe = String(code).trim().replace(/\s+/g, '_').replace(/\//g, '_');
  try {
    await mqttPublish(`FormaReaEDF/initialisateur/${prefix}/lecteur_code_barre/${safe}`, {
      code: String(code).trim(),
      date_valide: date_valide ? 'oui' : 'non',
      zone_valide: zone_valide ? 'oui' : 'non'
    });
    res.json({ success: true });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.post('/api/mqtt/barriere', async (req, res) => {
  const { etat, prefix = 'initialisateur1' } = req.body;
  try {
    await mqttPublish(`FormaReaEDF/initialisateur/${prefix}/barriere/etat`, { etat: etat === 'ouverte' ? 1 : 0 });
    res.json({ success: true });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.post('/api/mqtt/reset', async (req, res) => {
  const { valeur, prefix = 'initialisateur1' } = req.body;
  try {
    await mqttPublish(`FormaReaEDF/initialisateur/${prefix}/reset/etat`, { reset: valeur === 1 ? 1 : 0 });
    res.json({ success: true });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

/* ======================================= MYSQL ======================================= */
const db = mysql.createPool({
  host: '192.168.191.14',
  port: 53306,
  user: 'admin',
  password: 'superbddnormandie765',
  database: 'EDF',
  waitForConnections: true,
  connectionLimit: 10
});

db.query('SELECT 1', (err) => {
  if (err) { console.error('❌ Erreur MySQL:', err); return; }
  console.log('✅ Connecté à MySQL');

  db.query('CREATE TABLE IF NOT EXISTS scans (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(255) NOT NULL, date_valid TINYINT(1) DEFAULT 0, zone_valid TINYINT(1) DEFAULT 0, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)', (err) => {
    if (err) { console.error('❌ Erreur table scans:', err.message); return; }
    console.log('✅ Table scans prête');
    db.query('ALTER TABLE scans MODIFY COLUMN date_valid TINYINT(1) DEFAULT 0', () => {});
    db.query('ALTER TABLE scans MODIFY COLUMN zone_valid TINYINT(1) DEFAULT 0', () => {});
    db.query('UPDATE scans SET date_valid = 0 WHERE date_valid IS NULL', () => {});
    db.query('UPDATE scans SET zone_valid = 0 WHERE zone_valid IS NULL', () => {});
  });

  db.query('CREATE TABLE IF NOT EXISTS init_attestation (id_attestation VARCHAR(255) NOT NULL PRIMARY KEY, date_valide TINYINT(1) DEFAULT 0, zone_valide TINYINT(1) DEFAULT 0, nom VARCHAR(100) DEFAULT NULL, prenom VARCHAR(100) DEFAULT NULL)', (err) => {
    if (err) { console.error('❌ Erreur table init_attestation:', err.message); return; }
    console.log('✅ Table init_attestation prête');
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='initialisateur' AND TABLE_NAME='init_attestation' AND COLUMN_NAME='nom'", (err, rows) => {
      if (!err && rows.length === 0) db.query('ALTER TABLE init_attestation ADD COLUMN nom VARCHAR(100) DEFAULT NULL', () => {});
    });
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='initialisateur' AND TABLE_NAME='init_attestation' AND COLUMN_NAME='prenom'", (err, rows) => {
      if (!err && rows.length === 0) db.query('ALTER TABLE init_attestation ADD COLUMN prenom VARCHAR(100) DEFAULT NULL', () => {});
    });
  });

  db.query('CREATE TABLE IF NOT EXISTS init_badge (id_badge VARCHAR(6) NOT NULL PRIMARY KEY, formation TINYINT(1) DEFAULT 0, visite_medical TINYINT(1) DEFAULT 0)', (err) => {
    if (err) { console.error('❌ Erreur table init_badge:', err.message); return; }
    console.log('✅ Table init_badge prête');
  });

  db.query('CREATE TABLE IF NOT EXISTS init_dosi (id_dosi VARCHAR(6) NOT NULL PRIMARY KEY, batterie TINYINT(1) DEFAULT 0, hors_service TINYINT(1) DEFAULT 0)', (err) => {
    if (err) { console.error('❌ Erreur table init_dosi:', err.message); return; }
    console.log('✅ Table init_dosi prête');
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='initialisateur' AND TABLE_NAME='init_dosi' AND COLUMN_NAME='batterie'", (err, rows) => {
      if (!err && rows.length === 0) db.query('ALTER TABLE init_dosi ADD COLUMN batterie TINYINT(1) DEFAULT 0', () => {});
    });
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='initialisateur' AND TABLE_NAME='init_dosi' AND COLUMN_NAME='hors_service'", (err, rows) => {
      if (!err && rows.length === 0) db.query('ALTER TABLE init_dosi ADD COLUMN hors_service TINYINT(1) DEFAULT 0', () => {});
    });
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='initialisateur' AND TABLE_NAME='init_dosi' AND COLUMN_NAME='formation'", (err, rows) => {
      if (!err && rows.length > 0) db.query('ALTER TABLE init_dosi DROP COLUMN formation', () => {});
    });
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='initialisateur' AND TABLE_NAME='init_dosi' AND COLUMN_NAME='visite_medical'", (err, rows) => {
      if (!err && rows.length > 0) db.query('ALTER TABLE init_dosi DROP COLUMN visite_medical', () => {});
    });
  });
});

/* ======================================= ROUTES SCANS ======================================= */
app.post('/api/scan', (req, res) => {
  const { code, date_valid, zone_valid } = req.body;
  if (!code) return res.status(400).json({ error: 'Code manquant' });
  const normalizedCode = normalizeCode(code);
  const dateValue = (date_valid === 1 || date_valid === true || date_valid === '1') ? 1 : 0;
  const zoneValue = (zone_valid === 1 || zone_valid === true || zone_valid === '1') ? 1 : 0;
  db.query('INSERT INTO scans (code, date_valid, zone_valid) VALUES (?, ?, ?)', [normalizedCode, dateValue, zoneValue], (err, result) => {
    if (err) { console.error('❌ Erreur INSERT:', err); return res.status(500).json({ error: 'Erreur BDD' }); }
    res.json({ success: true, id: result.insertId });
  });
});

app.get('/api/scans', (req, res) => {
  db.query('SELECT * FROM scans ORDER BY timestamp DESC LIMIT 100', (err, results) => {
    if (err) return res.status(500).json({ error: 'Erreur BDD' });
    res.json(results);
  });
});

app.get('/api/scan/by-code/:code', (req, res) => {
  const code = normalizeCode(decodeURIComponent(req.params.code));
  db.query('SELECT * FROM scans WHERE code = ? ORDER BY timestamp DESC LIMIT 1', [code], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur BDD' });
    if (rows.length === 0) return res.json({ found: false });
    res.json({ found: true, data: rows[0] });
  });
});

app.put('/api/scan/by-code/:code', (req, res) => {
  const code = normalizeCode(decodeURIComponent(req.params.code));
  const dateValue = (req.body.date_valid === 1 || req.body.date_valid === true || req.body.date_valid === '1') ? 1 : 0;
  const zoneValue = (req.body.zone_valid === 1 || req.body.zone_valid === true || req.body.zone_valid === '1') ? 1 : 0;
  db.query('SELECT id FROM scans WHERE code = ? ORDER BY timestamp DESC LIMIT 1', [code], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur BDD' });
    if (rows.length > 0) {
      db.query('UPDATE scans SET date_valid = ?, zone_valid = ? WHERE id = ?', [dateValue, zoneValue, rows[0].id], (err) => {
        if (err) return res.status(500).json({ error: 'Erreur BDD' });
        res.json({ success: true, action: 'updated', id: rows[0].id });
      });
    } else {
      db.query('INSERT INTO scans (code, date_valid, zone_valid) VALUES (?, ?, ?)', [code, dateValue, zoneValue], (err, result) => {
        if (err) return res.status(500).json({ error: 'Erreur BDD' });
        res.json({ success: true, action: 'inserted', id: result.insertId });
      });
    }
  });
});

app.put('/api/scan/:id', (req, res) => {
  const { id } = req.params;
  const { date_valid, zone_valid } = req.body;
  if (date_valid === undefined && zone_valid === undefined) return res.status(400).json({ error: 'Au moins un champ requis' });
  let q = 'UPDATE scans SET '; const vals = [];
  if (date_valid !== undefined) { q += 'date_valid = ?, '; vals.push((date_valid === 1 || date_valid === true || date_valid === '1') ? 1 : 0); }
  if (zone_valid !== undefined) { q += 'zone_valid = ?, '; vals.push((zone_valid === 1 || zone_valid === true || zone_valid === '1') ? 1 : 0); }
  q = q.slice(0, -2) + ' WHERE id = ?'; vals.push(id);
  db.query(q, vals, (err) => {
    if (err) return res.status(500).json({ error: 'Erreur BDD' });
    db.query('SELECT * FROM scans WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: 'Erreur SELECT' });
      res.json({ success: true, data: row[0] });
    });
  });
});

app.get('/api/attestation/all', (req, res) => {
  db.query('SELECT * FROM init_attestation ORDER BY id_attestation', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ attestations: rows });
  });
});

/* ======================================= ROUTES ATTESTATION ======================================= */
app.get('/api/attestation/by-code/:code', (req, res) => {
  const code = normalizeCode(decodeURIComponent(req.params.code));
  db.query('SELECT * FROM init_attestation WHERE id_attestation = ? LIMIT 1', [code], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) return res.json({ found: false });
    res.json({ found: true, data: rows[0] });
  });
});

app.put('/api/attestation/by-code/:code', (req, res) => {
  const code = normalizeCode(decodeURIComponent(req.params.code));
  const { date_valide, zone_valide, nom, prenom } = req.body;
  const dateValue = (date_valide === 1 || date_valide === true || date_valide === '1') ? 1 : 0;
  const zoneValue = (zone_valide === 1 || zone_valide === true || zone_valide === '1') ? 1 : 0;
  const nomValue = nom || null;
  const prenomValue = prenom || null;
  console.log(`📋 attestation: "${code}" | date=${dateValue} | zone=${zoneValue} | nom=${nomValue} | prenom=${prenomValue}`);
  db.query('SELECT id_attestation FROM init_attestation WHERE id_attestation = ? LIMIT 1', [code], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length > 0) {
      db.query('UPDATE init_attestation SET date_valide = ?, zone_valide = ?, nom = ?, prenom = ? WHERE id_attestation = ?', [dateValue, zoneValue, nomValue, prenomValue, code], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, action: 'updated' });
      });
    } else {
      db.query('INSERT INTO init_attestation (id_attestation, date_valide, zone_valide, nom, prenom) VALUES (?, ?, ?, ?, ?)', [code, dateValue, zoneValue, nomValue, prenomValue], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, action: 'inserted' });
      });
    }
  });
});

/* ======================================= ROUTES BADGE ======================================= */
app.get('/api/badge/all', (req, res) => {
  db.query('SELECT id_badge FROM init_badge', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ badges: rows.map(r => r.id_badge) });
  });
});

app.get('/api/badge/:id', (req, res) => {
  db.query('SELECT formation, visite_medical FROM init_badge WHERE id_badge = ?', [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) return res.json({ exists: false, formation: false, visite_medical: false });
    res.json({ exists: true, formation: rows[0].formation === 1, visite_medical: rows[0].visite_medical === 1 });
  });
});

app.post('/api/badge', (req, res) => {
  const { numbadge, formation, visite_medical } = req.body;
  db.query('INSERT INTO init_badge (id_badge, formation, visite_medical) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE formation = ?, visite_medical = ?', [numbadge, formation ? 1 : 0, visite_medical ? 1 : 0, formation ? 1 : 0, visite_medical ? 1 : 0], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'badge enregistré' });
  });
});

app.delete('/api/badge/all', (req, res) => {
  db.query('DELETE FROM init_badge', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Tous les badges supprimés' });
  });
});

app.delete('/api/badge/:id', (req, res) => {
  db.query('DELETE FROM init_badge WHERE id_badge = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'badge supprimé' });
  });
});

/* ======================================= ROUTES DOSI ======================================= */
app.get('/api/dosi/all', (req, res) => {
  db.query('SELECT id_dosi FROM init_dosi', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ dosis: rows.map(r => r.id_dosi) });
  });
});

app.get('/api/dosi/:id', (req, res) => {
  db.query('SELECT batterie, hors_service FROM init_dosi WHERE id_dosi = ?', [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) return res.json({ exists: false, batterie: false, hors_service: false });
    res.json({ exists: true, batterie: rows[0].batterie === 1, hors_service: rows[0].hors_service === 1 });
  });
});

app.post('/api/dosi', (req, res) => {
  const { numdosi, batterie, hors_service } = req.body;
  db.query('INSERT INTO init_dosi (id_dosi, batterie, hors_service) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE batterie = ?, hors_service = ?', [numdosi, batterie ? 1 : 0, hors_service ? 1 : 0, batterie ? 1 : 0, hors_service ? 1 : 0], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'dosimètre enregistré' });
  });
});

app.delete('/api/dosi/all', (req, res) => {
  db.query('DELETE FROM init_dosi', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Tous les dosimètres supprimés' });
  });
});

app.delete('/api/dosi/:id', (req, res) => {
  db.query('DELETE FROM init_dosi WHERE id_dosi = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'dosimètre supprimé' });
  });
});

/* ======================================= SERVEURS HTTP / HTTPS ======================================= */
const HTTP_PORT = 3000;
// APRÈS — écoute sur toutes les interfaces
app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur HTTP sur http://192.168.191.14:${HTTP_PORT}`);
});

app.listen(5001, '0.0.0.0', () => {
  console.log(`🚀 Serveur HTTP sur http://192.168.191.14:3000`);
});

app.listen(55001, '0.0.0.0', () => {
  console.log(`🚀 Serveur HTTP sur http://192.168.191.14:55001`);
});


try {
  const certDir  = path.join(__dirname, 'python obligé');
  const certFile = path.join(certDir, 'cert.pem');
  const keyFile  = path.join(certDir, 'key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const options = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
    https.createServer(options, app).listen(3001, () => {
      console.log(`🔒 Serveur HTTPS sur https://192.168.190.8:3001`);
    });
  } else {
    console.warn('⚠️ Certificats introuvables — HTTPS non démarré');
  }
} catch (err) {
  console.error('❌ Erreur démarrage HTTPS:', err);
}