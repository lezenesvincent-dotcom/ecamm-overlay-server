// server.js - Serveur WebSocket pour eCamm Overlay
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ========== CORS MIDDLEWARE ==========
// Autoriser les requêtes depuis GitHub Pages
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

// Pour servir des fichiers statiques si besoin
app.use(express.static('public'));

// ========== STOCKAGE DES DONNÉES ==========
// Format attendu par la page Création
let latestData = {
  titre: "En attente...",
  soustitre: "",
  p1: {
    sujet: "",
    contenu: []
  },
  p2: {
    sujet: "",
    contenu: []
  },
  p3: {
    sujet: "",
    contenu: []
  },
  p4: {
    sujet: "",
    contenu: []
  }
};

// Garder une trace de tous les clients connectés
const clients = new Set();

// Gestion des connexions WebSocket
wss.on('connection', (ws, req) => {
  console.log('✅ Nouveau client connecté');
  clients.add(ws);
  
  // Envoyer les dernières données au nouveau client
  ws.send(JSON.stringify({
    type: 'initial',
    data: latestData
  }));
  
  console.log('📤 Données initiales envoyées:', latestData.titre);
  
  // Recevoir les messages
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      
      // Si c'est une mise à jour depuis la page de gestion
      if (parsed.type === 'update') {
        latestData = parsed.data;
        console.log('🔄 Données mises à jour:', latestData.titre);
        console.log('📊 Données complètes:', JSON.stringify(latestData, null, 2));
        
        // Diffuser à tous les clients (overlays eCamm)
        clients.forEach(client => {
          if (client !== ws && client.readyState === 1) { // 1 = OPEN
            client.send(JSON.stringify({
              type: 'update',
              data: latestData
            }));
          }
        });
        
        console.log(`📡 Diffusé à ${clients.size - 1} autres client(s)`);
      }
    } catch (error) {
      console.error('❌ Erreur parsing message:', error);
    }
  });
  
  // Gérer la déconnexion
  ws.on('close', () => {
    console.log('👋 Client déconnecté');
    clients.delete(ws);
  });
  
  // Gérer les erreurs
  ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error);
    clients.delete(ws);
  });
});

// Route de test
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>eCamm Overlay Server</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #1a1a2e;
          color: #e4e4e4;
        }
        h1 { color: #667eea; }
        .status {
          background: #16213e;
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
          border-left: 4px solid #667eea;
        }
        .connected { color: #28a745; }
        .data {
          background: #0f3460;
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
          font-family: 'Courier New', monospace;
          font-size: 0.9rem;
          overflow-x: auto;
        }
      </style>
    </head>
    <body>
      <h1>🚀 eCamm Overlay WebSocket Server</h1>
      <div class="status">
        <p><strong>Status:</strong> <span class="connected">✅ Actif</span></p>
        <p><strong>Clients connectés:</strong> ${clients.size}</p>
        <p><strong>Dernier titre:</strong> ${latestData.titre}</p>
      </div>
      <div class="data">
        <strong>📦 Dernières données:</strong>
        <pre>${JSON.stringify(latestData, null, 2)}</pre>
      </div>
    </body>
    </html>
  `);
});

// Route pour récupérer les données actuelles (API REST)
app.get('/api/data', (req, res) => {
  console.log('📥 GET /api/data - Données envoyées');
  res.json(latestData);
});

// Route pour mettre à jour les données via HTTP POST (optionnel)
app.use(express.json());
app.post('/api/data', (req, res) => {
  try {
    latestData = req.body;
    console.log('🔄 Données mises à jour via POST:', latestData.titre);
    
    // Diffuser aux clients WebSocket
    clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'update',
          data: latestData
        }));
      }
    });
    
    res.json({ success: true, data: latestData });
  } catch (error) {
    console.error('❌ Erreur POST:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur WebSocket démarré sur le port ${PORT}`);
  console.log(`   HTTP: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
});
