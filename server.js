const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// État global pour le graphique
let graphSettings = {
    cameraOffset: { x: 0, y: 5, z: 32 },
    cameraAngle: { horizontal: 0, vertical: -20 },
    graphMeshOffset: { x: 0, y: 0, z: 0 },
    lightPosition: { x: 5, y: 10, z: 7 },
    lightIntensity: 0.6,
    labelsXOffset: { x: 0, y: 0 },
    labelsYOffset: { x: 0, y: 0 },
    barreRougeOffset: { x: 0, y: -7.5, z: 0 },
    barreRougeIntensity: 1.5,
    barreRougeSize: { width: 9, height: 0.325, depth: 8 },
    graphWidth: 100,
    fontSizeLabelsX: 100,
    fontSizeLabelsY: 128,
    labelsXSpacing: 1.0
};

// Liste des clients connectés
let clients = new Set();

// WebSocket
wss.on('connection', (ws) => {
    console.log('✅ Nouveau client connecté');
    clients.add(ws);
    console.log(`👥 Clients connectés: ${clients.size}`);

    // Envoyer les paramètres actuels au nouveau client
    ws.send(JSON.stringify({
        type: 'init',
        settings: graphSettings
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Message reçu:', data.type);

            if (data.type === 'update') {
                // Sauvegarder les nouveaux paramètres
                graphSettings = { ...graphSettings, ...data.settings };
                console.log('💾 Paramètres sauvegardés');

                // Broadcaster à tous les autres clients
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update',
                            settings: graphSettings
                        }));
                    }
                });
                console.log('📤 Paramètres diffusés aux autres clients');
            }
        } catch (error) {
            console.error('❌ Erreur parsing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('🔌 Client déconnecté');
        clients.delete(ws);
        console.log(`👥 Clients restants: ${clients.size}`);
    });

    ws.on('error', (error) => {
        console.error('❌ Erreur WebSocket:', error);
        clients.delete(ws);
    });
});

// Route de test
app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 Serveur WebSocket Graph 3D</h1>
        <p>✅ Serveur actif</p>
        <p>👥 Clients connectés: ${clients.size}</p>
        <p>📊 Paramètres actuels: ${JSON.stringify(graphSettings, null, 2)}</p>
    `);
});

// API REST pour récupérer les paramètres
app.get('/api/settings', (req, res) => {
    res.json(graphSettings);
});

// Démarrer le serveur
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ========================================');
    console.log('   Serveur WebSocket Graph 3D');
    console.log('🚀 ========================================');
    console.log('');
    console.log(`   📡 HTTP: http://localhost:${PORT}`);
    console.log(`   🔌 WebSocket: ws://localhost:${PORT}`);
    console.log('');
    console.log('   ✅ Serveur démarré avec succès !');
    console.log('');
});
