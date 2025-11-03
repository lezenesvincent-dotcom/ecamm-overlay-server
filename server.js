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

// Stockage en mémoire
let latestData = {
    titre: 'En attente...',
    soustitre: '',
    p1: { sujet: '', contenu: [] },
    p2: { sujet: '', contenu: [] },
    p3: { sujet: '', contenu: [] },
    p4: { sujet: '', contenu: [] }
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
        <h1>🚀 eCamm Overlay WebSocket Server</h1>
        <p><strong>Status:</strong> ✅ Online</p>
        <p><strong>Connected clients:</strong> ${clients.size}</p>
        <p><strong>History size:</strong> ${contentHistory.length} items</p>
        <p><strong>Latest title:</strong> ${latestData.titre}</p>
        <hr>
        <h3>📡 API Endpoints:</h3>
        <ul>
            <li><strong>GET</strong> /api/data - Récupérer les dernières données</li>
            <li><strong>GET</strong> /api/history - Récupérer tout l'historique</li>
            <li><strong>POST</strong> /api/data - Mettre à jour les données</li>
            <li><strong>POST</strong> /api/focus - Changer le focus (subjectIndex: 0-5)</li>
            <li><strong>DELETE</strong> /api/history/:id - Supprimer un élément de l'historique</li>
        </ul>
    `);
});

// GET /api/data - Récupérer les dernières données
app.get('/api/data', (req, res) => {
    console.log('📤 GET /api/data');
    res.json(latestData);
});

// GET /api/history - Récupérer tout l'historique
app.get('/api/history', (req, res) => {
    console.log('📤 GET /api/history - Historique:', contentHistory.length, 'éléments');
    res.json(contentHistory);
});

// POST /api/data - Mettre à jour les données
app.post('/api/data', (req, res) => {
    console.log('📥 POST /api/data');
    console.log('Données reçues:', JSON.stringify(req.body, null, 2));
    
    latestData = req.body;
    
    // Ajouter à l'historique avec ID et timestamp
    const historyItem = {
        id: 'ws-' + Date.now(),
        timestamp: new Date().toISOString(),
        source: 'websocket',
        ...latestData
    };
    
    // Ajouter au début de l'historique
    contentHistory.unshift(historyItem);
    
    // Limiter la taille de l'historique
    if (contentHistory.length > MAX_HISTORY) {
        contentHistory = contentHistory.slice(0, MAX_HISTORY);
    }
    
    console.log('✅ Historique mis à jour:', contentHistory.length, 'éléments');
    
    // Broadcaster aux clients WebSocket
    broadcastToClients({
        type: 'update',
        data: latestData
    });
    
    res.json({ 
        success: true, 
        message: 'Données mises à jour',
        historySize: contentHistory.length
    });
});

// POST /api/focus - Changer le focus
app.post('/api/focus', (req, res) => {
    const { subjectIndex } = req.body;
    
    console.log('🎯 POST /api/focus - subjectIndex:', subjectIndex);
    
    if (subjectIndex === undefined || subjectIndex === null) {
        return res.status(400).json({ 
            success: false, 
            error: 'subjectIndex is required' 
        });
    }
    
    // Broadcaster le changement de focus aux clients WebSocket
    broadcastToClients({
        type: 'focus',
        subjectIndex: parseInt(subjectIndex)
    });
    
    console.log('✅ Focus broadcasted à', clients.size, 'client(s)');
    
    res.json({ 
        success: true, 
        message: `Focus changed to subject ${subjectIndex}`,
        clients: clients.size
    });
});

// DELETE /api/history/:id - Supprimer un élément de l'historique
app.delete('/api/history/:id', (req, res) => {
    const { id } = req.params;
    console.log('🗑️ DELETE /api/history/' + id);
    
    const initialLength = contentHistory.length;
    contentHistory = contentHistory.filter(item => item.id !== id);
    
    if (contentHistory.length < initialLength) {
        console.log('✅ Élément supprimé. Historique:', contentHistory.length, 'éléments');
        res.json({ 
            success: true, 
            message: 'Item deleted',
            historySize: contentHistory.length
        });
    } else {
        console.log('⚠️ Élément non trouvé:', id);
        res.status(404).json({ 
            success: false, 
            error: 'Item not found' 
        });
    }
});

// ========================================
// WEBSOCKET
// ========================================

function broadcastToClients(message) {
    const messageStr = JSON.stringify(message);
    let successCount = 0;
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
            successCount++;
        }
    });
    
    console.log(`📡 Message broadcasted à ${successCount}/${clients.size} client(s)`);
}

wss.on('connection', (ws) => {
    console.log('🔌 Nouveau client WebSocket connecté');
    clients.add(ws);
    console.log('👥 Clients connectés:', clients.size);
    
    // Envoyer les dernières données au nouveau client
    ws.send(JSON.stringify({
        type: 'initial',
        data: latestData
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Message WebSocket reçu:', data.type);
            
            if (data.type === 'update') {
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
    console.log('   eCamm Overlay WebSocket Server');
    console.log('🚀 ========================================');
    console.log('');
    console.log('   📡 HTTP Server: http://localhost:' + PORT);
    console.log('   🔌 WebSocket: ws://localhost:' + PORT);
    console.log('');
    console.log('   ✅ Serveur démarré avec succès !');
    console.log('');
    console.log('🚀 ========================================');
    console.log('');
});
