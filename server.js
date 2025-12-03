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

// ============================================
// ÉTAT GLOBAL - P1P4 Content
// ============================================
let contentStore = [];
let currentContent = {
    titre: '',
    soustitre: '',
    p1: { sujet: '', contenu: [] },
    p2: { sujet: '', contenu: [] },
    p3: { sujet: '', contenu: [] },
    p4: { sujet: '', contenu: [] }
};

// ============================================
// ÉTAT GLOBAL - Graph 3D Settings
// ============================================
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

// ============================================
// WebSocket - Gestion des connexions
// ============================================
wss.on('connection', (ws) => {
    console.log('✅ Nouveau client connecté');
    clients.add(ws);
    console.log(`👥 Clients connectés: ${clients.size}`);

    // Envoyer le contenu actuel au nouveau client
    ws.send(JSON.stringify({
        type: 'initial',
        data: currentContent
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Message reçu:', data.type);

            // Message de type 'update' pour Graph 3D settings
            if (data.type === 'update' && data.settings) {
                graphSettings = { ...graphSettings, ...data.settings };
                console.log('💾 Graph settings sauvegardés');

                // Broadcaster aux autres clients
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update',
                            settings: graphSettings
                        }));
                    }
                });
            }
            
            // Message de type 'content' pour P1P4
            if (data.type === 'content' && data.data) {
                currentContent = data.data;
                console.log('💾 Contenu P1P4 sauvegardé:', currentContent.titre);

                // Broadcaster à TOUS les clients (y compris widgets)
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update',
                            data: currentContent
                        }));
                    }
                });
                console.log('📤 Contenu diffusé à tous les clients');
            }

            // Message de type 'focus' pour navigation NEXT
            if (data.type === 'focus') {
                console.log('🎯 Focus reçu, diffusion aux widgets');
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'focus',
                            subjectIndex: data.subjectIndex
                        }));
                    }
                });
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

// ============================================
// API REST - Routes P1P4
// ============================================

// GET /api/content - Récupérer le contenu actuel
app.get('/api/content', (req, res) => {
    res.json(currentContent);
});

// POST /api/content - Envoyer du contenu (et broadcaster)
app.post('/api/content', (req, res) => {
    currentContent = req.body;
    console.log('📝 Contenu reçu via API:', currentContent.titre);
    
    // Broadcaster à tous les clients WebSocket
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'update',
                data: currentContent
            }));
        }
    });
    
    res.json({ success: true, data: currentContent });
});

// GET /api/history - Récupérer l'historique
app.get('/api/history', (req, res) => {
    res.json(contentStore);
});

// POST /api/history - Ajouter à l'historique
app.post('/api/history', (req, res) => {
    const item = {
        ...req.body,
        id: 'api-' + Date.now(),
        timestamp: new Date().toISOString(),
        source: 'api'
    };
    contentStore.unshift(item);
    
    // Garder max 50 éléments
    if (contentStore.length > 50) {
        contentStore = contentStore.slice(0, 50);
    }
    
    console.log('📚 Historique mis à jour:', contentStore.length, 'éléments');
    res.json({ success: true, item });
});

// POST /api/data - Alias pour /api/content (compatibilité)
app.post('/api/data', (req, res) => {
    const item = {
        ...req.body,
        id: 'api-' + Date.now(),
        timestamp: new Date().toISOString(),
        source: 'api'
    };
    contentStore.unshift(item);
    
    if (contentStore.length > 50) {
        contentStore = contentStore.slice(0, 50);
    }
    
    // Aussi mettre à jour currentContent et broadcaster
    if (req.body.titre) {
        currentContent = {
            titre: req.body.title || req.body.titre || '',
            soustitre: req.body.subtitle || req.body.soustitre || '',
            p1: req.body.p1 || { sujet: '', contenu: [] },
            p2: req.body.p2 || { sujet: '', contenu: [] },
            p3: req.body.p3 || { sujet: '', contenu: [] },
            p4: req.body.p4 || { sujet: '', contenu: [] }
        };
        
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'update',
                    data: currentContent
                }));
            }
        });
    }
    
    res.json({ success: true, data: item });
});

// DELETE /api/history/:id - Supprimer un élément
app.delete('/api/history/:id', (req, res) => {
    const id = req.params.id;
    contentStore = contentStore.filter(item => item.id !== id);
    console.log('🗑️ Élément supprimé:', id);
    res.json({ success: true });
});

// ============================================
// API REST - Routes Graph 3D
// ============================================
app.get('/api/settings', (req, res) => {
    res.json(graphSettings);
});

app.post('/api/settings', (req, res) => {
    graphSettings = { ...graphSettings, ...req.body };
    res.json({ success: true, settings: graphSettings });
});

// ============================================
// Route de test / Status
// ============================================
app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 Serveur eCamm Overlay</h1>
        <p>✅ Serveur actif</p>
        <p>👥 Clients WebSocket connectés: ${clients.size}</p>
        <hr>
        <h2>📺 P1P4 Content</h2>
        <p>Titre actuel: ${currentContent.titre || '(vide)'}</p>
        <p>Historique: ${contentStore.length} éléments</p>
        <hr>
        <h2>📊 Graph 3D</h2>
        <pre>${JSON.stringify(graphSettings, null, 2)}</pre>
        <hr>
        <h3>API Endpoints:</h3>
        <ul>
            <li>GET /api/content - Contenu P1P4 actuel</li>
            <li>POST /api/content - Envoyer contenu</li>
            <li>GET /api/history - Historique</li>
            <li>POST /api/data - Créer contenu</li>
            <li>GET /api/settings - Graph 3D settings</li>
        </ul>
    `);
});

// ============================================
// Démarrage du serveur
// ============================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ========================================');
    console.log('   Serveur eCamm Overlay');
    console.log('🚀 ========================================');
    console.log('');
    console.log(`   📡 HTTP: http://localhost:${PORT}`);
    console.log(`   🔌 WebSocket: ws://localhost:${PORT}`);
    console.log('');
    console.log('   ✅ P1P4 Content API: Actif');
    console.log('   ✅ Graph 3D Settings: Actif');
    console.log('   ✅ WebSocket Broadcast: Actif');
    console.log('');
});
