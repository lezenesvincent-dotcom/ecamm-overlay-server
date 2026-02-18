const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Dossier vidéos sur le disque persistant
const VIDEOS_DIR = '/app/data/videos';
if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Servir les vidéos statiques depuis le disque persistant
app.use('/videos', express.static(VIDEOS_DIR));

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

let contentHistory = [];
const MAX_HISTORY = 50;
const clients = new Set();
let fichesStore = {};

// ========================================
// EMAIL + ICS CALENDAR
// ========================================

const mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'lezenes.vincent@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD || ''
    }
});

const icsSequenceMap = {};

function generateICS(cal) {
    const title = cal.title || 'Studio CIC';
    const location = cal.location || 'Studio CIC - 61 rue Taitbout, Paris 9e';
    const date = cal.date || new Date().toISOString().split('T')[0];
    const startTime = cal.startTime || '12:30';
    const endTime = cal.endTime || '13:00';
    const ficheId = cal.ficheId || Date.now().toString();

    const uid = 'fiche-' + ficheId + '@studio-cic';
    if (!icsSequenceMap[ficheId]) icsSequenceMap[ficheId] = 0;
    icsSequenceMap[ficheId]++;
    const sequence = icsSequenceMap[ficheId];

    const startParts = startTime.split(':');
    const endParts = endTime.split(':');
    const dateParts = date.split('-');
    const dtStart = dateParts.join('') + 'T' + startParts[0].padStart(2,'0') + startParts[1].padStart(2,'0') + '00';
    const dtEnd = dateParts.join('') + 'T' + endParts[0].padStart(2,'0') + endParts[1].padStart(2,'0') + '00';
    const now = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Studio CIC//Contact Studio//FR',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'DTSTART;TZID=Europe/Paris:' + dtStart,
        'DTEND;TZID=Europe/Paris:' + dtEnd,
        'DTSTAMP:' + now,
        'UID:' + uid,
        'SEQUENCE:' + sequence,
        'SUMMARY:' + title,
        'LOCATION:' + location,
        'DESCRIPTION:Fiche Contact Studio transmise automatiquement',
        'ORGANIZER;CN=CONTACT:mailto:lezenes.vincent@gmail.com',
        'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:vincent.lezenes@cic.fr',
        'CATEGORIES:' + (cal.category || 'Catégorie Bleue'),
        'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
        'X-MICROSOFT-CDO-INTENDEDSTATUS:BUSY',
        'COLOR:blue',
        'STATUS:CONFIRMED',
        'BEGIN:VALARM',
        'TRIGGER:-PT30M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Rappel Studio CIC',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');
}

// ========================================
// ROUTES API
// ========================================

app.get('/', (req, res) => {
    res.send(`
        <h1>🚀 eCamm Overlay WebSocket Server v3.1</h1>
        <p><strong>Status:</strong> ✅ Online</p>
        <p><strong>Connected clients:</strong> ${clients.size}</p>
        <p><strong>History size:</strong> ${contentHistory.length} items</p>
        <p><strong>Latest title:</strong> ${latestData.titre}</p>
        <p><strong>Graph settings last updated:</strong> ${graphSettings.lastUpdated}</p>
        <p><strong>Email:</strong> ✅ ICS Calendar enabled</p>
        <p><strong>Studio Alerts:</strong> ✅ Broadcast enabled</p>
    `);
});

app.get('/api/data', (req, res) => { res.json(latestData); });

app.post('/api/update', (req, res) => {
    latestData = req.body;
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
    const message = JSON.stringify({ type: 'update', data: latestData });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
    });
    res.json({ success: true, data: latestData });
});

app.post('/api/focus', (req, res) => {
    const { subjectIndex } = req.body;
    console.log(`📌 Focus demandé sur l'index: ${subjectIndex}`);
    const message = JSON.stringify({ type: 'focus', subjectIndex });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
    });
    res.json({ success: true, subjectIndex });
});

app.get('/api/graph', (req, res) => { res.json(graphSettings); });

app.post('/api/graph', (req, res) => {
    graphSettings = { ...req.body, lastUpdated: new Date().toISOString() };
    const message = JSON.stringify({ type: 'graph_settings', settings: graphSettings });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
    });
    res.json({ success: true, settings: graphSettings });
});

app.get('/history', (req, res) => { res.json(contentHistory); });

// ========================================
// FICHES STUDIO
// ========================================

app.post('/api/fiches', (req, res) => {
    const data = req.body;
    if (!data || !data.id) return res.status(400).json({ error: 'Missing fiche id' });
    fichesStore[data.id] = data;
    console.log('📝 Fiche sauvegardée:', data.id, data.titre || '(sans titre)');
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'fiche_updated', data }));
        }
    });
    res.json({ success: true, id: data.id });
});

app.get('/api/fiches/:id', (req, res) => {
    const fiche = fichesStore[req.params.id];
    if (!fiche) return res.status(404).json({ error: 'Fiche not found' });
    res.json(fiche);
});

app.get('/api/fiches', (req, res) => {
    const list = Object.values(fichesStore).map(f => ({
        id: f.id, titre: f.titre || '(sans titre)', date: f.date || '', updatedAt: f.updatedAt || ''
    }));
    list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(list);
});

app.delete('/api/fiches/:id', (req, res) => {
    if (fichesStore[req.params.id]) {
        delete fichesStore[req.params.id];
        console.log('🗑️ Fiche supprimée:', req.params.id);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Fiche not found' });
    }
});

// ========================================
// EMAIL - ENVOI FICHE + ICS
// ========================================

app.post('/api/send-fiche', async (req, res) => {
    try {
        const { to, subject, html, calendarDirect, calendarPrep, calendar } = req.body;
        if (!to || !subject || !html) {
            return res.status(400).json({ error: 'Missing to, subject, or html' });
        }
        const results = [];

        if (calendarDirect && calendarDirect.date) {
            const ics = generateICS({...calendarDirect, category: 'Catégorie Bleue'});
            await mailTransporter.sendMail({
                from: '"CONTACT" <lezenes.vincent@gmail.com>',
                to: to, subject: subject, html: html,
                icalEvent: { filename: 'invitation.ics', method: 'REQUEST', content: ics },
                attachments: [{ filename: 'invitation.ics', content: ics, contentType: 'text/calendar; method=REQUEST' }]
            });
            results.push('contact');
        }

        if (calendarDirect && calendarPrep) {
            await new Promise(r => setTimeout(r, 2000));
        }

        if (calendarPrep && calendarPrep.date) {
            const ics = generateICS({...calendarPrep, category: 'Catégorie Rouge'});
            const prepSubject = (calendarPrep.title || 'PRÉPA');
            await mailTransporter.sendMail({
                from: '"CONTACT" <lezenes.vincent@gmail.com>',
                to: to, subject: prepSubject,
                html: '<p style="font-family:Arial;color:#333;">Bloc préparation studio - ' + prepSubject + '</p>',
                icalEvent: { filename: 'invitation.ics', method: 'REQUEST', content: ics },
                attachments: [{ filename: 'invitation.ics', content: ics, contentType: 'text/calendar; method=REQUEST' }]
            });
            results.push('prepa');
        }

        if (calendar && calendar.date && results.length === 0) {
            const ics = generateICS(calendar);
            await mailTransporter.sendMail({
                from: '"CONTACT" <lezenes.vincent@gmail.com>',
                to: to, subject: subject, html: html,
                icalEvent: { filename: 'invitation.ics', method: 'REQUEST', content: ics },
                attachments: [{ filename: 'invitation.ics', content: ics, contentType: 'text/calendar; method=REQUEST' }]
            });
            results.push('legacy');
        }

        if (results.length === 0) {
            await mailTransporter.sendMail({
                from: '"CONTACT" <lezenes.vincent@gmail.com>',
                to: to, subject: subject, html: html
            });
            results.push('html-only');
        }

        console.log('✅ All sent:', results.join(', '));
        res.json({ ok: true, sent: results });
    } catch (err) {
        console.error('❌ Email error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// STUDIO 2027 - SUIVI TRAVAUX
// ========================================

let studio2027Data = null;
const STUDIO2027_FILE = '/app/data/studio2027.json';
try {
    if (fs.existsSync(STUDIO2027_FILE)) {
        studio2027Data = JSON.parse(fs.readFileSync(STUDIO2027_FILE, 'utf8'));
        console.log('📋 Studio 2027 data loaded from disk');
    }
} catch (err) { console.error('❌ Error loading studio2027:', err.message); }

app.get('/api/studio2027', (req, res) => {
    if (studio2027Data) { res.json(studio2027Data); }
    else { res.json({}); }
});

app.post('/api/studio2027', (req, res) => {
    studio2027Data = req.body;
    try { fs.writeFileSync(STUDIO2027_FILE, JSON.stringify(studio2027Data, null, 2)); } catch (err) { console.error('❌ Error saving studio2027:', err.message); }
    const message = JSON.stringify({ type: 'studio2027', data: studio2027Data });
    clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(message); });
    res.json({ success: true });
});

// ========================================
// STUDIO ALERTS
// ========================================

let studioAlerts = [];
const ALERTS_FILE = '/app/data/studio-alerts.json';
try {
    if (fs.existsSync(ALERTS_FILE)) {
        studioAlerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
        console.log('🚨 Alerts loaded:', studioAlerts.length);
    }
} catch (err) { console.error('Error loading alerts:', err.message); }

app.get('/api/studio-alerts', (req, res) => { res.json(studioAlerts); });

app.post('/api/studio-alerts', (req, res) => {
    studioAlerts = req.body;
    try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(studioAlerts, null, 2)); } catch(e) {}
    res.json({ success: true });
});

// ========================================
// DEV DASHBOARD
// ========================================

let devDashboard = null;
const DEV_FILE = '/app/data/dev-dashboard.json';
try {
    if (fs.existsSync(DEV_FILE)) {
        devDashboard = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8'));
        console.log('🛠️ Dev dashboard loaded');
    }
} catch (err) {}

app.get('/api/dev-dashboard', (req, res) => { res.json(devDashboard || {}); });

app.post('/api/dev-dashboard', (req, res) => {
    devDashboard = req.body;
    try { fs.writeFileSync(DEV_FILE, JSON.stringify(devDashboard, null, 2)); } catch(e) {}
    res.json({ success: true });
});

// ========================================
// UPLOAD & GESTION VIDÉOS
// ========================================

app.post('/api/upload-video', (req, res) => {
    const filename = req.headers['x-filename'];
    if (!filename) { return res.status(400).json({ error: 'Missing X-Filename header' }); }
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(VIDEOS_DIR, safeName);
    console.log('🎬 Upload vidéo:', safeName);
    const writeStream = fs.createWriteStream(filePath);
    req.pipe(writeStream);
    writeStream.on('finish', () => {
        const stats = fs.statSync(filePath);
        console.log('✅ Vidéo sauvegardée:', safeName, '(' + (stats.size / 1024 / 1024).toFixed(1) + ' MB)');
        res.json({ success: true, filename: safeName, size: stats.size, url: '/videos/' + safeName });
    });
    writeStream.on('error', (err) => {
        console.error('❌ Erreur upload:', err);
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    });
});

app.get('/api/videos-list', (req, res) => {
    try {
        const files = fs.readdirSync(VIDEOS_DIR).filter(f => !f.startsWith('.'));
        const list = files.map(f => {
            const stats = fs.statSync(path.join(VIDEOS_DIR, f));
            return { filename: f, size: stats.size, url: '/videos/' + f };
        });
        res.json(list);
    } catch (err) { res.json([]); }
});

app.delete('/api/videos/:filename', (req, res) => {
    const filePath = path.join(VIDEOS_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('🗑️ Vidéo supprimée:', req.params.filename);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// ========================================
// PROXY VIDÉO GOOGLE DRIVE
// ========================================

const https = require('https');

app.get('/api/video', (req, res) => {
    const fileId = req.query.id;
    if (!fileId) { return res.status(400).json({ error: 'Missing ?id= parameter' }); }
    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    console.log('🎬 Proxy vidéo demandé:', fileId);

    function fetchWithRedirects(url, redirectCount) {
        if (redirectCount > 5) {
            console.error('❌ Trop de redirections pour', fileId);
            return res.status(502).json({ error: 'Too many redirects' });
        }
        https.get(url, (driveRes) => {
            if ([301, 302, 303, 307, 308].includes(driveRes.statusCode) && driveRes.headers.location) {
                return fetchWithRedirects(driveRes.headers.location, redirectCount + 1);
            }
            const contentType = driveRes.headers['content-type'] || '';
            if (contentType.includes('text/html')) {
                let body = '';
                driveRes.on('data', chunk => body += chunk);
                driveRes.on('end', () => {
                    const confirmMatch = body.match(/confirm=([^&"]+)/);
                    if (confirmMatch) {
                        const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
                        return fetchWithRedirects(confirmUrl, redirectCount + 1);
                    }
                    const uuidMatch = body.match(/uuid=([^&"]+)/);
                    if (uuidMatch) {
                        const confirmUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t&uuid=${uuidMatch[1]}`;
                        return fetchWithRedirects(confirmUrl, redirectCount + 1);
                    }
                    res.status(502).json({ error: 'Google Drive blocked download' });
                });
                return;
            }
            let videoType = 'video/mp4';
            if (contentType.includes('video/')) videoType = contentType;
            res.setHeader('Content-Type', videoType);
            res.setHeader('Accept-Ranges', 'bytes');
            if (driveRes.headers['content-length']) res.setHeader('Content-Length', driveRes.headers['content-length']);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            driveRes.pipe(res);
        }).on('error', (err) => {
            console.error('❌ Erreur proxy vidéo:', err.message);
            res.status(502).json({ error: 'Failed to fetch from Google Drive' });
        });
    }
    fetchWithRedirects(driveUrl, 0);
});

// ========================================
// WEBSOCKET
// ========================================

wss.on('connection', (ws) => {
    console.log('👤 Nouveau client WebSocket connecté');
    clients.add(ws);
    console.log('👥 Clients connectés:', clients.size);

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
                latestData = data.data;
                const historyItem = {
                    id: 'ws-' + Date.now(),
                    timestamp: new Date().toISOString(),
                    source: 'websocket',
                    ...latestData
                };
                contentHistory.unshift(historyItem);
                if (contentHistory.length > MAX_HISTORY) contentHistory = contentHistory.slice(0, MAX_HISTORY);
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'update', data: latestData }));
                    }
                });
            }

            if (data.type === 'graph_settings') {
                graphSettings = { ...data.settings, lastUpdated: new Date().toISOString() };
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'graph_settings', settings: graphSettings }));
                    }
                });
            }

            if (data.type === 'focus') {
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'focus', subjectIndex: data.subjectIndex }));
                    }
                });
            }

            // ======== STUDIO ALERTS BROADCAST ========
            if (data.type === 'studio-alert' || data.type === 'studio-alert-update') {
                console.log('🚨 Alert broadcast:', data.type, data.data ? data.data.id : '');
                // Save to disk
                if (data.type === 'studio-alert' && data.data) {
                    if (!studioAlerts.find(a => a.id === data.data.id)) {
                        studioAlerts.unshift(data.data);
                        try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(studioAlerts, null, 2)); } catch(e) {}
                    }
                }
                if (data.type === 'studio-alert-update' && data.data) {
                    const alert = studioAlerts.find(a => a.id === data.data.id);
                    if (alert) {
                        alert.status = data.data.status;
                        try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(studioAlerts, null, 2)); } catch(e) {}
                    }
                }
                // Broadcast to ALL other clients
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }

            // ======== DEV DASHBOARD BROADCAST ========
            if (data.type === 'dev-dashboard-update') {
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
if (data.type === 'synthe_update') {
                const msg = JSON.stringify({ type: 'synthe_update', data: data.data });
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(msg);
                    }
                });
                console.log('🎬 Synthé update:', data.data ? data.data.nom : 'OFF');
            }
        } catch (error) {
            console.error('❌ Erreur parsing message WebSocket:', error);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('👥 Clients connectés:', clients.size);
    });

    ws.on('error', (error) => {
        console.error('❌ Erreur WebSocket:', error);
        clients.delete(ws);
    });
});

// ========================================
// DÉMARRAGE
// ========================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ========================================');
    console.log('   eCamm Overlay WebSocket Server v3.1');
    console.log('🚀 ========================================');
    console.log('   📡 HTTP: http://localhost:' + PORT);
    console.log('   🔌 WebSocket: ws://localhost:' + PORT);
    console.log('   📧 Email + ICS: enabled');
    console.log('   🚨 Studio Alerts: broadcast enabled');
    console.log('   🛠️ Dev Dashboard: enabled');
    console.log('   ✅ Serveur démarré !');
    console.log('');
});
