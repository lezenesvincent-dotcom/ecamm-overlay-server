# 💾 SERVEUR V2.0 - PERSISTANCE AMÉLIORÉE

## 🎯 Problème résolu

**Avant (v1.x)** :
- ❌ Données perdues au redémarrage du serveur
- ❌ Pas de backup automatique
- ❌ Historique limité à 50 éléments
- ❌ Aucune sauvegarde sur disque

**Maintenant (v2.0)** :
- ✅ Données sauvegardées automatiquement
- ✅ Backups horaires automatiques
- ✅ Historique 100 éléments (doublé)
- ✅ 20 backups gardés en permanence
- ✅ Graceful shutdown (sauvegarde avant arrêt)

---

## 📊 Système à 3 niveaux

### **Niveau 1 : Mémoire (temps réel)**
- Stockage en RAM pour performance maximale
- Disponible instantanément pour tous les clients
- Flag `dataChanged` pour savoir si besoin de sauvegarder

### **Niveau 2 : Fichiers JSON (toutes les 30s)**
- **Auto-save** : Sauvegarde automatique toutes les 30 secondes SI changements
- **content.json** : Dernières données P1-P4
- **history.json** : Historique des 100 dernières modifications

### **Niveau 3 : Backups (toutes les heures)**
- **Backup horaire automatique** avec timestamp
- **20 derniers backups** gardés (les plus vieux supprimés)
- **Backup manuel** disponible via API
- **Backup final** lors de l'arrêt du serveur

---

## 📁 Structure des fichiers

```
server/
├── server.js           # Serveur v2.0
├── package.json        # Dépendances
├── data/               # Créé automatiquement
│   ├── content.json    # Données actuelles
│   ├── history.json    # Historique 100 items
│   └── backups/        # Backups horodatés
│       ├── backup_2025-11-06T08-00-00-000Z.json
│       ├── backup_2025-11-06T09-00-00-000Z.json
│       └── ...         # Jusqu'à 20 backups
```

---

## 🆕 Nouvelles fonctionnalités

### **Auto-save intelligent**
```javascript
// Sauvegarde uniquement si changements
if (dataChanged) {
    await saveData(); // Toutes les 30s
}
```

### **Backup manuel**
```bash
curl -X POST http://localhost:3000/api/backup
```

### **Sauvegarde forcée**
```bash
curl -X POST http://localhost:3000/api/save
```

### **Lister les backups**
```bash
curl http://localhost:3000/api/backups
```

### **Graceful shutdown**
```bash
# Le serveur sauvegarde automatiquement avant de s'arrêter
kill -SIGTERM <pid>
# ou Ctrl+C
```

---

## 🔧 Configuration

### **Variables d'environnement**

```bash
# Dossier de données (par défaut: ./data)
DATA_DIR=/path/to/data

# Port (par défaut: 3000)
PORT=8080
```

### **Paramètres dans le code**

```javascript
// Auto-save interval (30 secondes)
const AUTO_SAVE_INTERVAL = 30000;

// Historique max (100 éléments)
const MAX_HISTORY = 100;

// Backups gardés (20 derniers)
const MAX_BACKUPS = 20;
```

---

## 📡 Nouvelles routes API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/backups` | Liste des backups disponibles |
| POST | `/api/save` | Force la sauvegarde immédiate |
| POST | `/api/backup` | Crée un backup manuel |

---

## 🚀 Déploiement sur Render.com

### **Important : Stockage persistant**

⚠️ **Render.com FREE tier** : Le disque est **éphémère** (reset à chaque redémarrage).

**Solutions :**

1. **Upgrade vers plan payant** ($7/mois)
   - Stockage persistant garanti
   - Pas de sleep après 15 min

2. **Utiliser une DB externe** (gratuit)
   - MongoDB Atlas (512 MB gratuit)
   - Supabase (500 MB gratuit)
   - Firebase Realtime DB (1 GB gratuit)

3. **Backup externe** (recommandé même en payant)
   - GitHub automatique (via workflow)
   - Google Drive API
   - Dropbox API

### **Déploiement actuel**

Le serveur fonctionnera sur Render.com, mais :
- ✅ Les données persisteront **pendant que le serveur tourne**
- ✅ Auto-save toutes les 30s
- ✅ Backup horaire
- ⚠️ Mais **perte au redémarrage** si plan gratuit

---

## 🎯 Prochaines étapes recommandées

### **Court terme (cette session ?)**
1. ✅ Serveur v2.0 avec persistance fichier
2. 🔄 Déployer sur Render.com
3. 🔄 Tester la persistance

### **Moyen terme (semaine prochaine)**
1. Intégrer MongoDB Atlas (gratuit)
2. Workflow GitHub pour backup automatique
3. Tests automatisés de persistance

### **Long terme (mois prochain)**
1. Dashboard admin pour gérer les backups
2. Restauration depuis backup via UI
3. Multi-utilisateurs avec auth

---

## 🧪 Tests de persistance

### **Test 1 : Auto-save**
```bash
# 1. Démarrer le serveur
npm start

# 2. Mettre à jour les données
curl -X POST http://localhost:3000/api/data \
  -H "Content-Type: application/json" \
  -d '{"titre":"Test","p1":{"sujet":"Test"}}'

# 3. Attendre 31 secondes

# 4. Vérifier le fichier
cat data/content.json

# ✅ Devrait contenir les données
```

### **Test 2 : Redémarrage**
```bash
# 1. Arrêter le serveur (Ctrl+C)
# 2. Redémarrer
npm start

# 3. Vérifier les données
curl http://localhost:3000/api/data

# ✅ Devrait contenir les données précédentes
```

### **Test 3 : Backup manuel**
```bash
# 1. Créer un backup
curl -X POST http://localhost:3000/api/backup

# 2. Lister les backups
curl http://localhost:3000/api/backups

# ✅ Devrait montrer le nouveau backup
```

---

## 📊 Métriques

| Métrique | v1.x | v2.0 |
|----------|------|------|
| **Persistance** | ❌ Aucune | ✅ Fichiers JSON |
| **Auto-save** | ❌ Non | ✅ 30s |
| **Backups** | ❌ Aucun | ✅ Horaires |
| **Historique** | 50 items | 100 items |
| **Graceful shutdown** | ❌ Non | ✅ Oui |
| **API restore** | ❌ Non | 🔄 Prochaine version |

---

## 🐛 Troubleshooting

### **Erreur : EACCES permission denied**
```bash
# Donner les droits sur le dossier data
chmod -R 755 data/
```

### **Données ne se sauvegardent pas**
```bash
# Vérifier les logs
tail -f logs/server.log

# Forcer la sauvegarde
curl -X POST http://localhost:3000/api/save
```

### **Backups non créés**
```bash
# Vérifier que le dossier existe
ls -la data/backups/

# Créer manuellement si nécessaire
mkdir -p data/backups
```

---

## 📄 Logs

Le serveur log automatiquement :
- ✅ Chargement des données au démarrage
- ✅ Sauvegarde automatique
- ✅ Création de backups
- ✅ Nettoyage des vieux backups
- ✅ Arrêt propre avec sauvegarde finale

---

**Version** : 2.0.0  
**Date** : 6 novembre 2025  
**Auteur** : Vincent Lezenes + Claude
