const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// ========================================
// CONFIGURATION PERSISTANCE
// ========================================

const DATA_DIR = process.env.DATA_DIR || './data';
const DATA_FILE = path.join(DATA_DIR, 'content.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Auto-save toutes les 30 secondes
const AUTO_SAVE_INTERVAL = 30000;
let autoSaveTimer = null;
let dataChanged = false;

// ========================================
// STOCKAGE EN MÉMOIRE
// ========================================

let latestData = {
    titre: 'En attente...',
    soustitre: '',
    p1: { sujet: '', contenu: [] },
    p2: { sujet: '', contenu: [] },
    p3: { sujet: '', contenu: [] },
    p4: { sujet: '', contenu: [] }
};

// Historique (max 100 éléments pour plus de backup)
let contentHistory = [];
const MAX_HISTORY = 100;

// Clients WebSocket connectés
const clients = new Set();

// ========================================
// FONCTIONS DE PERSISTANCE
// ========================================

async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        console.log('✅ Dossiers de données créés/vérifiés');
    } catch (error) {
        console.error('❌ Erreur création dossiers:', error);
    }
}

async function loadData() {
    try {
        console.log('📂 Chargement des données depuis le disque...');
        
        // Charger les données principales
        try {
            const data = await fs.readFile(DATA_FILE, 'utf8');
            latestData = JSON.parse(data);
            console.log('✅ Données principales chargées');
        } catch (error) {
            console.log('ℹ️  Pas de données sauvegardées, utilisation des valeurs par défaut');
        }
        
        // Charger l'historique
        try {
            const history = await fs.readFile(HISTORY_FILE, 'utf8');
            contentHistory = JSON.parse(history);
            console.log('✅ Historique chargé:', contentHistory.length, 'éléments');
        } catch (error) {
            console.log('ℹ️  Pas d\'historique sauvegardé');
        }
        
        console.log('✅ Chargement terminé');
    } catch (error) {
        console.error('❌ Erreur chargement données:', error);
    }
}

async function saveData() {
    if (!dataChanged) {
        return; // Pas de changement, pas besoin de sauvegarder
    }
    
    try {
        console.log('💾 Sauvegarde des données...');
        
        // Sauvegarder les données principales
        await fs.writeFile(
            DATA_FILE, 
            JSON.stringify(latestData, null, 2),
            'utf8'
        );
        
        // Sauvegarder l'historique
        await fs.writeFile(
            HISTORY_FILE,
            JSON.stringify(contentHistory, null, 2),
            'utf8'
        );
        
        dataChanged = false;
        console.log('✅ Données sauvegardées avec succès');
        
        return true;
    } catch (error) {
        console.error('❌ Erreur sauvegarde:', error);
        return false;
    }
}

async function createBackup() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.json`);
        
        const backup = {
            timestamp: new Date().toISOString(),
            data: latestData,
            history: contentHistory.slice(0, 10) // 10 derniers éléments
        };
        
        await fs.writeFile(backupFile, JSON.stringify(backup, null, 2));
        console.log('✅ Backup créé:', backupFile);
        
        // Nettoyer les vieux backups (garder les 20 derniers)
        await cleanOldBackups();
    } catch (error) {
        console.error('❌ Erreur création backup:', error);
    }
}

async function cleanOldBackups() {
    try {
        const files = await fs.readdir(BACKUP_DIR);
        const backupFiles = files
            .filter(f => f.startsWith('backup_'))
            .sort()
            .reverse();
        
        // Supprimer les backups au-delà de 20
        if (backupFiles.length > 20) {
            const toDelete = backupFiles.slice(20);
            for (const file of toDelete) {
                await fs.unlink(path.join(BACKUP_DIR, file));
            }
            console.log('🗑️ Nettoyage:', toDelete.length, 'anciens backups supprimés');
        }
    } catch (error) {
        console.error('❌ Erreur nettoyage backups:', error);
    }
}

function startAutoSave() {
    autoSaveTimer = setInterval(async () => {
        if (dataChanged) {
            await saveData();
        }
    }, AUTO_SAVE_INTERVAL);
    
    console.log('⏰ Auto-save activé (toutes les 30 secondes)');
}

function stopAutoSave() {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
        console.log('⏰ Auto-save désactivé');
    }
}

// ========================================
// ROUTES API
// ========================================

app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 eCamm Overlay WebSocket Server v2.0</h1>
        <p><strong>Status:</strong> ✅ Online</p>
        <p><strong>Connected clients:</strong> ${clients.size}</p>
        <p><strong>History size:</strong> ${contentHistory.length} items</p>
        <p><strong>Latest title:</strong> ${latestData.titre}</p>
        <p><strong>Data changed:</strong> ${dataChanged ? '⚠️ Yes (pending save)' : '✅ No'}</p>
        <hr>
        <h3>📡 API Endpoints:</h3>
        <ul>
            <li><strong>GET</strong> /api/data - Récupérer les dernières données</li>
            <li><strong>GET</strong> /api/history - Récupérer tout l'historique</li>
            <li><strong>GET</strong> /api/backups - Lister les backups disponibles</li>
            <li><strong>POST</strong> /api/data - Mettre à jour les données</li>
            <li><strong>POST</strong> /api/focus - Changer le focus (subjectIndex: 0-5)</li>
            <li><strong>POST</strong> /api/save - Forcer la sauvegarde immédiate</li>
            <li><strong>POST</strong> /api/backup - Créer un backup manuel</li>
            <li><strong>DELETE</strong> /api/history/:id - Supprimer un élément de l'historique</li>
        </ul>
        <hr>
        <h3>💾 Persistance:</h3>
        <ul>
            <li>Auto-save: Toutes les 30 secondes si changements</li>
            <li>Backup automatique: Toutes les heures</li>
            <li>Backups gardés: 20 derniers</li>
        </ul>
    `);
});

app.get('/api/data', (req, res) => {
    console.log('📤 GET /api/data');
    res.json(latestData);
});

app.get('/api/history', (req, res) => {
    console.log('📤 GET /api/history -', contentHistory.length, 'éléments');
    res.json(contentHistory);
});

app.get('/api/backups', async (req, res) => {
    try {
        const files = await fs.readdir(BACKUP_DIR);
        const backups = files
            .filter(f => f.startsWith('backup_'))
            .sort()
            .reverse()
            .map(f => ({
                filename: f,
                path: `/api/backups/${f}`,
                timestamp: f.replace('backup_', '').replace('.json', '')
            }));
        
        res.json({ backups, count: backups.length });
    } catch (error) {
        res.status(500).json({ error: 'Error listing backups' });
    }
});

app.post('/api/data', (req, res) => {
    console.log('📥 POST /api/data');
    
    latestData = req.body;
    dataChanged = true;
    
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
    
    console.log('✅ Données mises à jour (en attente de sauvegarde)');
    
    // Broadcaster
    broadcastToClients({
        type: 'update',
        data: latestData
    });
    
    res.json({ 
        success: true, 
        message: 'Données mises à jour',
        historySize: contentHistory.length,
        willSaveIn: `${AUTO_SAVE_INTERVAL / 1000}s max`
    });
});

app.post('/api/focus', (req, res) => {
    const { subjectIndex } = req.body;
    
    console.log('🎯 POST /api/focus - subjectIndex:', subjectIndex);
    
    if (subjectIndex === undefined || subjectIndex === null) {
        return res.status(400).json({ 
            success: false, 
            error: 'subjectIndex is required' 
        });
    }
    
    broadcastToClients({
        type: 'focus',
        subjectIndex: parseInt(subjectIndex)
    });
    
    res.json({ 
        success: true, 
        message: `Focus changed to subject ${subjectIndex}`,
        clients: clients.size
    });
});

app.post('/api/save', async (req, res) => {
    console.log('💾 POST /api/save - Sauvegarde forcée');
    const success = await saveData();
    res.json({ 
        success, 
        message: success ? 'Data saved successfully' : 'Save failed' 
    });
});

app.post('/api/backup', async (req, res) => {
    console.log('📦 POST /api/backup - Backup manuel');
    await createBackup();
    res.json({ success: true, message: 'Backup created' });
});

app.delete('/api/history/:id', (req, res) => {
    const { id } = req.params;
    const initialLength = contentHistory.length;
    contentHistory = contentHistory.filter(item => item.id !== id);
    dataChanged = true;
    
    if (contentHistory.length < initialLength) {
        res.json({ success: true, historySize: contentHistory.length });
    } else {
        res.status(404).json({ success: false, error: 'Item not found' });
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
    
    console.log(`📡 Broadcasted à ${successCount}/${clients.size} client(s)`);
}

wss.on('connection', (ws) => {
    console.log('🔌 Nouveau client WebSocket');
    clients.add(ws);
    console.log('👥 Clients:', clients.size);
    
    // Envoyer les dernières données
    ws.send(JSON.stringify({
        type: 'initial',
        data: latestData
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'update') {
                latestData = data.data;
                dataChanged = true;
                
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
                
                // Broadcaster aux autres
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
            console.error('❌ Erreur WebSocket:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 Client déconnecté');
        clients.delete(ws);
        console.log('👥 Clients:', clients.size);
    });
    
    ws.on('error', (error) => {
        console.error('❌ Erreur:', error);
        clients.delete(ws);
    });
});

// ========================================
// BACKUP AUTOMATIQUE (toutes les heures)
// ========================================

setInterval(async () => {
    console.log('📦 Backup automatique horaire...');
    await createBackup();
}, 3600000); // 1 heure

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

async function shutdown() {
    console.log('\n⚠️  Arrêt du serveur...');
    
    stopAutoSave();
    
    // Sauvegarder avant de quitter
    if (dataChanged) {
        console.log('💾 Sauvegarde finale...');
        await saveData();
    }
    
    // Créer un backup final
    await createBackup();
    
    console.log('✅ Arrêt propre terminé');
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ========================================
// DÉMARRAGE
// ========================================

async function start() {
    console.log('🚀 Démarrage du serveur...');
    
    await ensureDataDir();
    await loadData();
    startAutoSave();
    
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log('');
        console.log('🚀 ========================================');
        console.log('   eCamm Overlay Server v2.0');
        console.log('   📡 AVEC PERSISTANCE');
        console.log('🚀 ========================================');
        console.log('');
        console.log(`   🌐 HTTP: http://localhost:${PORT}`);
        console.log(`   🔌 WebSocket: ws://localhost:${PORT}`);
        console.log('');
        console.log('   💾 Auto-save: Toutes les 30s');
        console.log('   📦 Backup: Toutes les heures');
        console.log('   📂 Données:', DATA_FILE);
        console.log('   📚 Historique:', HISTORY_FILE);
        console.log('');
        console.log('   ✅ Serveur prêt !');
        console.log('');
        console.log('🚀 ========================================');
        console.log('');
    });
}

start();
