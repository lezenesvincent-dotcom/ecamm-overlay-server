const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
app.use(cors());
app.use(express.json());

// Stockage des clients connectés
const clients = new Set();

// Historique des contenus (max 50)
let contentHistory = [];
const MAX_HISTORY = 50;

// Dernières données
let latestData = {
    titre: '',
    soustitre: '',
    p1: { sujet: '', contenu: [] },
    p2: { sujet: '', contenu: [] },
    p3: { sujet: '', contenu: [] },
    p4: { sujet: '', contenu: [] }
};

// Index du sujet actuellement focalisé (0 = tous visibles)
let currentFocusIndex = 0;

console.log('🚀 Serveur WebSocket P1-P4 démarré');
console.log('📦 Historique: max', MAX_HISTORY, 'éléments');

// Gestion des connexions WebSocket
wss.on('connection', (ws) => {
    console.log('✅ Nouveau client connecté');
    clients.add(ws);
    console.log(`   📊 Clients actifs: ${clients.size}`);

    // Envoyer les données initiales au nouveau client
    ws.send(JSON.stringify({
        type: 'initial',
        data: latestData
    }));

    // Envoyer l'état du focus actuel
    if (currentFocusIndex > 0) {
        ws.send(JSON.stringify({
            type: 'focus',
            subjectIndex: currentFocusIndex
        }));
    }

    // Gérer les messages reçus
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Message reçu:', data.type);

            if (data.type === 'update') {
                latestData = data.data;
                console.log('💾 Données mises à jour:', latestData.titre);

                // Ajouter à l'historique
                addToHistory(latestData);

                // Broadcaster aux autres clients
                broadcastToAll({
                    type: 'update',
                    data: latestData
                });
            }
        } catch (error) {
            console.error('❌ Erreur parsing message:', error);
        }
    });

    // Gérer la déconnexion
    ws.on('close', () => {
        console.log('❌ Client déconnecté');
        clients.delete(ws);
        console.log(`   📊 Clients actifs: ${clients.size}`);
    });

    // Gérer les erreurs
    ws.on('error', (error) => {
        console.error('❌ Erreur WebSocket:', error);
        clients.delete(ws);
    });
});

// Fonction pour broadcaster à tous les clients
function broadcastToAll(message) {
    const messageStr = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

// Fonction pour ajouter à l'historique
function addToHistory(data) {
    const historyItem = {
        id: `ws-${Date.now()}`,
        timestamp: new Date().toISOString(),
        source: 'websocket',
        ...data
    };

    contentHistory.unshift(historyItem);

    // Limiter à MAX_HISTORY éléments
    if (contentHistory.length > MAX_HISTORY) {
        contentHistory = contentHistory.slice(0, MAX_HISTORY);
    }

    console.log(`📚 Historique: ${contentHistory.length} élément(s)`);
}

// Routes API
app.get('/', (req, res) => {
    res.send(`
        <h1>🎥 eCamm Overlay WebSocket Server</h1>
        <p><strong>Statut:</strong> ✅ Actif</p>
        <p><strong>Clients connectés:</strong> ${clients.size}</p>
        <p><strong>Historique:</strong> ${contentHistory.length}/${MAX_HISTORY} éléments</p>
        <p><strong>Dernières données:</strong> ${latestData.titre || '(vide)'}</p>
        <p><strong>Focus actuel:</strong> ${currentFocusIndex === 0 ? 'Tous les sujets' : `Sujet ${currentFocusIndex}`}</p>
        <hr>
        <h3>📡 Endpoints disponibles:</h3>
        <ul>
            <li>GET /api/data - Dernières données</li>
            <li>POST /api/data - Mettre à jour les données</li>
            <li>GET /api/history - Historique complet</li>
            <li>POST /api/focus - Changer le focus (subjectIndex: 0-4)</li>
        </ul>
    `);
});

// GET /api/data - Récupérer les dernières données
app.get('/api/data', (req, res) => {
    console.log('📤 GET /api/data');
    res.json(latestData);
});

// POST /api/data - Mettre à jour les données
app.post('/api/data', (req, res) => {
    console.log('📥 POST /api/data');
    latestData = req.body;
    console.log('💾 Données mises à jour:', latestData.titre);

    // Ajouter à l'historique
    addToHistory(latestData);

    // Broadcaster aux clients WebSocket
    broadcastToAll({
        type: 'update',
        data: latestData
    });

    res.json({ success: true, data: latestData });
});

// GET /api/history - Récupérer l'historique complet
app.get('/api/history', (req, res) => {
    console.log('📤 GET /api/history');
    console.log(`   📚 Envoi de ${contentHistory.length} élément(s)`);
    res.json(contentHistory);
});

// POST /api/focus - Changer le focus sur un sujet
app.post('/api/focus', (req, res) => {
    const { subjectIndex } = req.body;
    
    // Valider l'index (0-4)
    if (typeof subjectIndex !== 'number' || subjectIndex < 0 || subjectIndex > 4) {
        return res.status(400).json({ 
            success: false, 
            error: 'subjectIndex doit être un nombre entre 0 et 4' 
        });
    }

    currentFocusIndex = subjectIndex;
    console.log(`🎯 Focus changé: ${currentFocusIndex === 0 ? 'Tous les sujets' : `Sujet ${currentFocusIndex}`}`);

    // Broadcaster le changement de focus à tous les clients
    broadcastToAll({
        type: 'focus',
        subjectIndex: currentFocusIndex
    });

    res.json({ 
        success: true, 
        focusIndex: currentFocusIndex,
        message: currentFocusIndex === 0 ? 'Tous les sujets visibles' : `Focus sur sujet ${currentFocusIndex}`
    });
});

// DELETE /api/history/:id - Supprimer un élément de l'historique
app.delete('/api/history/:id', (req, res) => {
    const { id } = req.params;
    
    const initialLength = contentHistory.length;
    contentHistory = contentHistory.filter(item => item.id !== id);
    
    if (contentHistory.length < initialLength) {
        console.log(`🗑️ Élément supprimé: ${id}`);
        console.log(`   📚 Historique: ${contentHistory.length} élément(s) restant(s)`);
        
        res.json({ 
            success: true, 
            message: 'Élément supprimé',
            remainingCount: contentHistory.length
        });
    } else {
        res.status(404).json({ 
            success: false, 
            error: 'Élément non trouvé' 
        });
    }
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 Serveur WebSocket P1-P4 actif');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   🌐 HTTP: http://localhost:${PORT}`);
    console.log(`   🔌 WebSocket: ws://localhost:${PORT}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
