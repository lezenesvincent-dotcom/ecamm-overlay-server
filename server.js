// ========================================
// eCamm Overlay WebSocket Server v2.0
// Version: 2.0 - 10 novembre 2025
// Ajout: Persistance graphique 3D
// ========================================

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

// ========================================
// STOCKAGE EN MÉMOIRE
// ========================================

// Contenu P1-P4
let latestData = {
    titre: 'En attente...',
    soustitre: '',
    p1: { sujet: '', contenu: [] },
    p2: { sujet: '', contenu: [] },
    p3: { sujet: '', contenu: [] },
    p4: { sujet: '', contenu: [] }
};

// NOUVEAU : Paramètres du graphique 3D
let graphSettings = {
    cameraOffset: { x: 0, y: 0, z: 0 },
    cameraAngle: { yaw: 0, pitch: 0, roll: 0 },
    graphOffset: { x: 0, y: 0, z: 0 },
    lightPosition: { x: 10, y: 10, z: 10 },
    lightIntensity: 1.5,
    labelsXOffset: { x: 0, y: 0, z: 0 },
    labelsYOffset: { x: 0, y: 0, z: 0 },
    barreRougeOffset: { x: 0, y: 0, z: 0 },
    barreRougeSize: { width: 0.2, height: 15, depth: 0.2 },
    lastUpdated: new Date().toISOString()
};

// Historique (max 50 éléments)
let contentHistory = [];
const MAX_HISTORY = 50;

// Clients WebSocket connectés
const clients = new Set();

// ========================================
// ROUTES API
// ========================================

// GET / - Page d'accueil
app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 eCamm Overlay WebSocket Server v2.0</h1>
        <p><strong>Status:</strong> ✅ Online</p>
        <p><strong>Connected clients:</strong> ${clients.size}</p>
        <p><strong>History size:</strong> ${contentHistory.length} items</p>
        <p><strong>Latest title:</strong> ${latestData.titre}</p>
        <p><strong>Graph settings last updated:</strong> ${graphSettings.lastUpdated}</p>
        <hr>
        <h3>📡 API Endpoints:</h3>
        <ul>
            <li><strong>GET</strong> /api/data - Récupérer le contenu P1-P4</li>
            <li><strong>POST</strong> /api/update - Mettre à jour le contenu</li>
            <li><strong>POST</strong> /api/focus - Mettre le focus sur P1-P4 ou Graph</li>
            <li><strong>GET</strong> /api/graph - Récupérer les paramètres du graphique 3D</li>
            <li><strong>POST</strong> /api/graph - Sauvegarder les paramètres du graphique 3D</li>
            <li><strong>GET</strong> /history - Historique des contenus</li>
        </ul>
        <hr>
        <h3>🔌 WebSocket:</h3>
        <p>Connect to: <code>wss://[hostname]/</code></p>
        <p>Message types: <code>init</code>, <code>update</code>, <code>focus</code>, <code>graph_settings</code></p>
    `);
});

// GET /api/data - Récupérer le contenu actuel
app.get('/api/data', (req, res) => {
    res.json(latestData);
});

// POST /api/update - Mettre à jour le contenu
app.post('/api/update', (req, res) => {
    latestData = req.body;
    
    // Ajouter à l'historique
    const historyItem = {
        id: 'api-' + Date.now(),
        timestamp: new Date().toISOString(),
        source: 'api',
        ...latestData
    };
    
    contentHistory.unshift(historyItem);
    
    if (contentHistory.length > MAX_HISTORY) {
        contentHistory = contentHistory.slice(0, MAX_HISTORY);
    }
    
    // Broadcaster via WebSocket
    const message = JSON.stringify({
        type: 'update',
        data: latestData
    });
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    
    res.json({ success: true, data: latestData });
});

// POST /api/focus - Mettre le focus sur une section
app.post('/api/focus', (req, res) => {
    const { subjectIndex } = req.body;
    
    console.log(`📌 Focus demandé sur l'index: ${subjectIndex}`);
    
    // Broadcaster via WebSocket
    const message = JSON.stringify({
        type: 'focus',
        subjectIndex: subjectIndex
    });
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    
    res.json({ success: true, subjectIndex });
});

// GET /api/graph - Récupérer les paramètres du graphique 3D
app.get('/api/graph', (req, res) => {
    console.log('📊 Paramètres graphique demandés');
    res.json(graphSettings);
});

// POST /api/graph - Sauvegarder les paramètres du graphique 3D
app.post('/api/graph', (req, res) => {
    const newSettings = req.body;
    
    // Mise à jour des paramètres
    graphSettings = {
        ...newSettings,
        lastUpdated: new Date().toISOString()
    };
    
    console.log('💾 Paramètres graphique sauvegardés:', graphSettings);
    
    // Broadcaster via WebSocket à tous les clients
    const message = JSON.stringify({
        type: 'graph_settings',
        settings: graphSettings
    });
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    
    res.json({ success: true, settings: graphSettings });
});

// GET /history - Historique des contenus
app.get('/history', (req, res) => {
    res.json(contentHistory);
});

// ========================================
// WEBSOCKET
// ========================================

wss.on('connection', (ws) => {
    console.log('👤 Nouveau client WebSocket connecté');
    clients.add(ws);
    console.log('👥 Clients connectés:', clients.size);
    
    // Envoyer l'état initial (contenu P1-P4 + paramètres graph)
    ws.send(JSON.stringify({
        type: 'init',
        data: latestData,
        graphSettings: graphSettings
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Message WebSocket reçu:', data.type);
            
            if (data.type === 'update') {
                // Mise à jour contenu P1-P4
                latestData = data.data;
                
                // Ajouter à l'historique
                const historyItem = {
                    id: 'ws-' + Date.now(),
                    timestamp: new Date().toISOString(),
                    source: 'websocket',
                    ...latestData
                };
                
                contentHistory.unshift(historyItem);
                
                if (contentHistory.length > MAX_HISTORY) {
                    contentHistory = contentHistory.slice(0, MAX_HISTORY);
                }
                
                // Broadcaster à tous les autres clients
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update',
                            data: latestData
                        }));
                    }
                });
            }
            
            if (data.type === 'graph_settings') {
                // Mise à jour paramètres graphique 3D
                graphSettings = {
                    ...data.settings,
                    lastUpdated: new Date().toISOString()
                };
                
                console.log('💾 Paramètres graphique mis à jour via WebSocket');
                
                // Broadcaster à tous les autres clients
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'graph_settings',
                            settings: graphSettings
                        }));
                    }
                });
            }
            
            if (data.type === 'focus') {
                // Demande de focus sur une section
                console.log(`📌 Focus demandé sur l'index: ${data.subjectIndex}`);
                
                // Broadcaster à tous les clients
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'focus',
                            subjectIndex: data.subjectIndex
                        }));
                    }
                });
            }
            
        } catch (error) {
            console.error('❌ Erreur parsing message WebSocket:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 Client WebSocket déconnecté');
        clients.delete(ws);
        console.log('👥 Clients connectés:', clients.size);
    });
    
    ws.on('error', (error) => {
        console.error('❌ Erreur WebSocket:', error);
        clients.delete(ws);
    });
});

// ========================================
// DÉMARRAGE DU SERVEUR
// ========================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ========================================');
    console.log('   eCamm Overlay WebSocket Server v2.0');
    console.log('🚀 ========================================');
    console.log('');
    console.log('   📡 HTTP Server: http://localhost:' + PORT);
    console.log('   🔌 WebSocket: ws://localhost:' + PORT);
    console.log('');
    console.log('   ✅ Serveur démarré avec succès !');
    console.log('   📊 Persistance graphique 3D activée');
    console.log('');
});
