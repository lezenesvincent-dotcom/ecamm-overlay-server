// server.js - Serveur WebSocket pour eCamm Overlay
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Pour servir des fichiers statiques si besoin
app.use(express.static('public'));

// Stocker les dernières données
let latestData = {
  title: "En attente...",
  subtitle: "",
  line1: "",
  line2: "",
  line3: "",
  line4: "",
  line5: "",
  line6: "",
  line7: "",
  line8: "",
  line9: "",
  line10: "",
  line11: "",
  line12: "",
  line13: "",
  line14: "",
  line15: "",
  line16: "",
  line17: "",
  line18: "",
  line19: "",
  line20: "",
  line21: "",
  line22: "",
  line23: "",
  line24: ""
};

// Garder une trace de tous les clients connectés
const clients = new Set();

// Gestion des connexions WebSocket
wss.on('connection', (ws, req) => {
  console.log('Nouveau client connecté');
  clients.add(ws);
  
  // Envoyer les dernières données au nouveau client
  ws.send(JSON.stringify({
    type: 'initial',
    data: latestData
  }));

  // Recevoir les messages
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      
      // Si c'est une mise à jour depuis la page de gestion
      if (parsed.type === 'update') {
        latestData = parsed.data;
        console.log('Données mises à jour:', latestData.title);
        
        // Diffuser à tous les clients (overlays eCamm)
        clients.forEach(client => {
          if (client !== ws && client.readyState === 1) { // 1 = OPEN
            client.send(JSON.stringify({
              type: 'update',
              data: latestData
            }));
          }
        });
      }
    } catch (error) {
      console.error('Erreur parsing message:', error);
    }
  });

  // Gérer la déconnexion
  ws.on('close', () => {
    console.log('Client déconnecté');
    clients.delete(ws);
  });

  // Gérer les erreurs
  ws.on('error', (error) => {
    console.error('Erreur WebSocket:', error);
    clients.delete(ws);
  });
});

// Route de test
app.get('/', (req, res) => {
  res.send(`
    <h1>eCamm Overlay WebSocket Server</h1>
    <p>Serveur actif avec ${clients.size} client(s) connecté(s)</p>
    <p>Dernières données: ${latestData.title}</p>
  `);
});

// Route pour récupérer les données actuelles (API REST)
app.get('/api/data', (req, res) => {
  res.json(latestData);
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur WebSocket démarré sur le port ${PORT}`);
  console.log(`   HTTP: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
});
