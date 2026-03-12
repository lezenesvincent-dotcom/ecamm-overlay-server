const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// CONFIGURATION GITHUB GIST (Persistance)
// ============================================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID = process.env.GIST_ID || '';
const GIST_FILENAME = 'ecamm-overlay-history.json';

// ============================================
// CONFIGURATION GMAIL SMTP
// ============================================
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const STUDIO_EMAIL_TO = process.env.STUDIO_EMAIL_TO || '';

let transporter = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASSWORD
        }
    });
    console.log('✅ Gmail SMTP configuré:', GMAIL_USER);
}

// Envoyer un email avec invitation calendrier
async function sendCalendarEmail(fiche) {
    if (!transporter || !STUDIO_EMAIL_TO) {
        console.log('⚠️ Email non configuré, skip envoi');
        return;
    }
    if (!fiche.date) {
        console.log('⚠️ Pas de date dans la fiche, skip envoi email');
        return;
    }

    const dateStr = fiche.date.replace(/-/g, '');
    let dtStart, dtEnd;
    
    if (fiche.heureDirect) {
        const heureStart = fiche.heureDirect.replace(':', '') + '00';
        dtStart = dateStr + 'T' + heureStart;
        const [h, m] = fiche.heureDirect.split(':').map(Number);
        const endM = m + 30;
        const finalH = endM >= 60 ? h + 2 : h + 1;
        const finalM = endM >= 60 ? endM - 60 : endM;
        dtEnd = dateStr + 'T' + String(finalH).padStart(2, '0') + String(finalM).padStart(2, '0') + '00';
    } else {
        dtStart = dateStr + 'T090000';
        dtEnd = dateStr + 'T100000';
    }

    let description = [];
    if (fiche.entite) description.push('Entite: ' + fiche.entite);
    if (fiche.contact) description.push('Contact: ' + fiche.contact);
    if (fiche.heurePrep) description.push('Preparation: ' + fiche.heurePrep);
    if (fiche.heureDirect) description.push('Direct: ' + fiche.heureDirect);
    if (fiche.application) description.push('Application: ' + fiche.application);
    if (fiche.mode) description.push('Mode: ' + fiche.mode);
    if (fiche.intervenants && fiche.intervenants.length) {
        description.push('Intervenants:');
        fiche.intervenants.forEach((p, i) => {
            description.push('  ' + (i+1) + '. ' + [p.prenom, p.nom, p.fonction ? '(' + p.fonction + ')' : ''].filter(Boolean).join(' '));
        });
    }

    const uid = (fiche.id || Date.now()) + '@studio-cic';
    const summary = fiche.titre || 'Prestation Studio CIC';
    const location = 'Studio CIC - 61 rue Taitbout, Paris 3e etage';
    const descText = description.join('\\n');
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Studio CIC//Content Manager//FR',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'UID:' + uid,
        'DTSTAMP:' + now,
        'DTSTART;TZID=Europe/Paris:' + dtStart,
        'DTEND;TZID=Europe/Paris:' + dtEnd,
        'SUMMARY:' + summary,
        'LOCATION:' + location,
        'DESCRIPTION:' + descText,
        'ORGANIZER;CN=Studio CIC:mailto:' + GMAIL_USER,
        'ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:' + STUDIO_EMAIL_TO,
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'BEGIN:VALARM',
        'TRIGGER:-PT30M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Preparation studio dans 30 min',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');

    const mailOptions = {
        from: '"Studio CIC" <' + GMAIL_USER + '>',
        to: STUDIO_EMAIL_TO,
        subject: '📋 ' + summary + ' - ' + fiche.date,
        text: 'Nouvelle prestation studio:\\n\\n' + description.join('\\n'),
        icalEvent: {
            method: 'REQUEST',
            content: icsContent
        }
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('📧 Email calendrier envoyé à', STUDIO_EMAIL_TO);
    } catch (error) {
        console.error('❌ Erreur envoi email:', error.message);
    }
}

// ============================================
// ÉTAT GLOBAL - P1P4 Content
// ============================================
let contentStore = [];
let lastSaveTime = 0;
const SAVE_INTERVAL = 10000; // Sauvegarder au max toutes les 10 secondes

// ============================================
// FONCTIONS GITHUB GIST
// ============================================
async function loadFromGist() {
    if (!GITHUB_TOKEN || !GIST_ID) {
        console.log('⚠️ Gist non configuré - pas de persistance');
        return;
    }
    
    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (response.ok) {
            const gist = await response.json();
            if (gist.files && gist.files[GIST_FILENAME]) {
                const content = JSON.parse(gist.files[GIST_FILENAME].content);
                contentStore = content.history || [];
                console.log(`✅ Historique chargé depuis Gist: ${contentStore.length} éléments`);
            }
        } else {
            console.log('⚠️ Gist non trouvé, démarrage avec historique vide');
        }
    } catch (error) {
        console.error('❌ Erreur chargement Gist:', error.message);
    }
}

async function saveToGist() {
    if (!GITHUB_TOKEN || !GIST_ID) return;
    
    // Limiter la fréquence de sauvegarde
    const now = Date.now();
    if (now - lastSaveTime < SAVE_INTERVAL) return;
    lastSaveTime = now;
    
    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: {
                    [GIST_FILENAME]: {
                        content: JSON.stringify({
                            lastUpdate: new Date().toISOString(),
                            history: contentStore
                        }, null, 2)
                    }
                }
            })
        });
        
        if (response.ok) {
            console.log(`💾 Historique sauvegardé sur Gist: ${contentStore.length} éléments`);
        } else {
            console.error('❌ Erreur sauvegarde Gist:', response.status);
        }
    } catch (error) {
        console.error('❌ Erreur sauvegarde Gist:', error.message);
    }
}
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

// Dernier état control (positions/scales des slots)
let lastControlState = null;

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

    // Envoyer le dernier état control (positions slots) si disponible
    if (lastControlState) {
        ws.send(JSON.stringify({
            type: 'control',
            command: 'UPDATE_STATE',
            state: lastControlState
        }));
        console.log('📤 Dernier état control envoyé au nouveau client');
    }

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
            
            // Message de type 'control' pour les commandes du joystick
            if (data.type === 'control') {
                console.log('🎮 Commande control reçue:', data.command);
                
                // Mémoriser le dernier état pour les nouveaux clients
                if (data.state) {
                    lastControlState = data.state;
                }

                // Broadcaster à tous les autres clients (widgets)
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'control',
                            command: data.command,
                            state: data.state
                        }));
                    }
                });
                console.log('📤 Commande diffusée aux widgets');
            }

            // ---- FICHES STUDIO via WebSocket ----
            if (data.type === 'fiches_get') {
                ws.send(JSON.stringify({
                    type: 'fiches_data',
                    data: fichesStore
                }));
            }

            if (data.type === 'fiches_save') {
                const fiche = data.fiche;
                if (fiche && fiche.id) {
                    fiche.updatedAt = new Date().toISOString();
                    fichesStore[fiche.id] = fiche;
                    console.log('📋 Fiche sauvegardée via WS:', fiche.titre || fiche.id);

                    // Broadcaster à TOUS les clients
                    const msg = JSON.stringify({ type: 'fiches_updated', data: fichesStore });
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(msg);
                        }
                    });
                }
            }

            if (data.type === 'fiches_delete') {
                if (data.id && fichesStore[data.id]) {
                    delete fichesStore[data.id];
                    console.log('🗑️ Fiche supprimée via WS:', data.id);

                    const msg = JSON.stringify({ type: 'fiches_updated', data: fichesStore });
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(msg);
                        }
                    });
                }
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
    saveToGist(); // Sauvegarder sur Gist
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
    if (req.body.titre || req.body.title) {
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
    
    saveToGist(); // Sauvegarder sur Gist
    res.json({ success: true, data: item });
});

// DELETE /api/history/:id - Supprimer un élément
app.delete('/api/history/:id', (req, res) => {
    const id = req.params.id;
    contentStore = contentStore.filter(item => item.id !== id);
    console.log('🗑️ Élément supprimé:', id);
    saveToGist(); // Sauvegarder sur Gist
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
// ÉTAT GLOBAL - Fiches Studio
// ============================================
let fichesStore = {};

// ============================================
// API REST - Routes Fiches Studio
// ============================================

// GET /api/fiches - Récupérer toutes les fiches
app.get('/api/fiches', (req, res) => {
    res.json(fichesStore);
});

// POST /api/fiches - Créer/Mettre à jour une fiche
app.post('/api/fiches', (req, res) => {
    const fiche = req.body;
    if (!fiche.id) {
        fiche.id = 'fiche-' + Date.now();
    }
    fiche.updatedAt = new Date().toISOString();
    fichesStore[fiche.id] = fiche;
    
    console.log('📋 Fiche studio sauvegardée:', fiche.titre || fiche.id);
    
    // Envoyer email calendrier
    sendCalendarEmail(fiche);
    
    // Broadcaster aux clients WebSocket
    const msg = JSON.stringify({ type: 'fiches_updated', data: fichesStore });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
    
    res.json({ success: true, fiche });
});

// DELETE /api/fiches/:id - Supprimer une fiche
app.delete('/api/fiches/:id', (req, res) => {
    delete fichesStore[req.params.id];
    console.log('🗑️ Fiche supprimée:', req.params.id);
    
    // Broadcaster aux clients WebSocket
    const msg = JSON.stringify({ type: 'fiches_updated', data: fichesStore });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
    
    res.json({ success: true });
});

// ============================================
// CALENDRIER ICS - Endpoint webcal
// ============================================
app.get('/api/calendar.ics', (req, res) => {
    const fiches = Object.values(fichesStore);
    
    let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Studio CIC//Content Manager//FR',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Studio CIC - Prestations',
        'X-WR-TIMEZONE:Europe/Paris'
    ];
    
    fiches.forEach(fiche => {
        if (!fiche.date) return;
        
        const dateStr = fiche.date.replace(/-/g, '');
        let dtStart, dtEnd;
        
        if (fiche.heureDirect) {
            const heureStart = fiche.heureDirect.replace(':', '') + '00';
            dtStart = dateStr + 'T' + heureStart;
            const [h, m] = fiche.heureDirect.split(':').map(Number);
            const endM = m + 30;
            const finalH = endM >= 60 ? h + 2 : h + 1;
            const finalM = endM >= 60 ? endM - 60 : endM;
            dtEnd = dateStr + 'T' + String(finalH).padStart(2, '0') + String(finalM).padStart(2, '0') + '00';
        } else {
            dtStart = dateStr;
            dtEnd = dateStr;
        }
        
        let description = [];
        if (fiche.entite) description.push('Entite: ' + fiche.entite);
        if (fiche.contact) description.push('Contact: ' + fiche.contact);
        if (fiche.heurePrep) description.push('Heure preparation: ' + fiche.heurePrep);
        if (fiche.heureDirect) description.push('Heure du direct: ' + fiche.heureDirect);
        if (fiche.application) description.push('Application: ' + fiche.application);
        if (fiche.mode) description.push('Mode: ' + fiche.mode);
        if (fiche.intervenants && fiche.intervenants.length) {
            description.push('Intervenants:');
            fiche.intervenants.forEach((p, i) => {
                description.push('  ' + (i+1) + '. ' + [p.prenom, p.nom, p.fonction ? '(' + p.fonction + ')' : '', p.entreprise ? '- ' + p.entreprise : ''].filter(Boolean).join(' '));
            });
        }
        const toggles = fiche.toggles || {};
        if (toggles.diffIBM === 'oui') {
            let ibmInfo = 'Diffusion IBM: Oui';
            if (fiche.ibmChaine) ibmInfo += ' - Chaine: ' + fiche.ibmChaine;
            if (fiche.ibmLien) ibmInfo += ' - Lien: ' + fiche.ibmLien;
            description.push(ibmInfo);
        }
        if (toggles.replay === 'oui') description.push('Replay: Oui');
        if (toggles.chat === 'oui') description.push('Chat: Oui');
        
        const descText = description.join('\\n');
        const uid = fiche.id + '@studio-cic';
        const summary = fiche.titre || 'Prestation Studio';
        const location = 'Studio CIC - 61 rue Taitbout, Paris 3e etage';
        
        icsContent.push('BEGIN:VEVENT');
        icsContent.push('UID:' + uid);
        icsContent.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
        
        if (fiche.heureDirect) {
            icsContent.push('DTSTART;TZID=Europe/Paris:' + dtStart);
            icsContent.push('DTEND;TZID=Europe/Paris:' + dtEnd);
        } else {
            icsContent.push('DTSTART;VALUE=DATE:' + dtStart);
            icsContent.push('DTEND;VALUE=DATE:' + dtEnd);
        }
        
        icsContent.push('SUMMARY:' + summary);
        icsContent.push('LOCATION:' + location);
        icsContent.push('DESCRIPTION:' + descText);
        
        if (fiche.heurePrep) {
            icsContent.push('BEGIN:VALARM');
            icsContent.push('TRIGGER:-PT30M');
            icsContent.push('ACTION:DISPLAY');
            icsContent.push('DESCRIPTION:Preparation studio dans 30 min');
            icsContent.push('END:VALARM');
        }
        
        icsContent.push('END:VEVENT');
    });
    
    icsContent.push('END:VCALENDAR');
    
    res.set({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="studio-cic.ics"',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.send(icsContent.join('\r\n'));
});

// ============================================
// Route de test / Status
// ============================================
app.get('/', (req, res) => {
    const gistStatus = GITHUB_TOKEN && GIST_ID 
        ? `✅ Actif (Gist ID: ${GIST_ID.substring(0, 8)}...)` 
        : '⚠️ Non configuré';
    
    res.send(`
        <h1>🚀 Serveur eCamm Overlay</h1>
        <p>✅ Serveur actif</p>
        <p>👥 Clients WebSocket connectés: ${clients.size}</p>
        <hr>
        <h2>💾 Persistance Gist</h2>
        <p>Status: ${gistStatus}</p>
        <hr>
        <h2>📺 P1P4 Content</h2>
        <p>Titre actuel: ${currentContent.titre || '(vide)'}</p>
        <p>Historique: ${contentStore.length} éléments</p>
        <hr>
        <h2>📊 Graph 3D</h2>
        <pre>${JSON.stringify(graphSettings, null, 2)}</pre>
        <hr>
        <h2>📋 Fiches Studio</h2>
        <p>Fiches enregistrées: ${Object.keys(fichesStore).length}</p>
        <p><a href="/api/calendar.ics">📅 Calendrier ICS</a></p>
        <hr>
        <h3>API Endpoints:</h3>
        <ul>
            <li>GET /api/content - Contenu P1P4 actuel</li>
            <li>POST /api/content - Envoyer contenu</li>
            <li>GET /api/history - Historique</li>
            <li>POST /api/data - Créer contenu</li>
            <li>GET /api/settings - Graph 3D settings</li>
            <li>GET /api/fiches - Toutes les fiches studio</li>
            <li>POST /api/fiches - Créer/MAJ fiche</li>
            <li>GET /api/calendar.ics - Calendrier ICS</li>
        </ul>
    `);
});

// ============================================
// Démarrage du serveur
// ============================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, async () => {
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
    
    // Email status
    if (GMAIL_USER && GMAIL_APP_PASSWORD && STUDIO_EMAIL_TO) {
        console.log('   ✅ Email calendrier: Actif → ' + STUDIO_EMAIL_TO);
    } else {
        console.log('   ⚠️ Email non configuré (GMAIL_USER, GMAIL_APP_PASSWORD, STUDIO_EMAIL_TO)');
    }
    
    // Charger l'historique depuis Gist
    if (GITHUB_TOKEN && GIST_ID) {
        console.log('   🔄 Chargement historique depuis Gist...');
        await loadFromGist();
        console.log(`   ✅ Gist Persistance: Actif (${contentStore.length} éléments)`);
    } else {
        console.log('   ⚠️ Gist non configuré - historique en mémoire uniquement');
        console.log('   💡 Ajoutez GITHUB_TOKEN et GIST_ID dans Render');
    }
    
    console.log('');
});
