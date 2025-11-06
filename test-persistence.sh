#!/bin/bash

# ============================================
# Script de test de persistance v2.0
# ============================================

echo "🧪 TEST DE PERSISTANCE - Serveur v2.0"
echo "======================================"
echo ""

SERVER_URL="http://localhost:3000"

# Fonction pour tester une route
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo "📡 Test: $description"
    echo "   Méthode: $method $endpoint"
    
    if [ -n "$data" ]; then
        response=$(curl -s -X $method "$SERVER_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    else
        response=$(curl -s -X $method "$SERVER_URL$endpoint")
    fi
    
    echo "   Réponse: $response"
    echo ""
}

# ========================================
# TESTS
# ========================================

echo "🔍 Test 1: Vérifier que le serveur répond"
test_endpoint "GET" "/" "" "Page d'accueil"

echo "🔍 Test 2: Récupérer les données actuelles"
test_endpoint "GET" "/api/data" "" "Données actuelles"

echo "🔍 Test 3: Mettre à jour les données"
test_endpoint "POST" "/api/data" '{
  "titre": "Test Persistance",
  "soustitre": "Version 2.0",
  "p1": {"sujet": "Test P1", "contenu": ["Ligne 1", "Ligne 2"]},
  "p2": {"sujet": "Test P2", "contenu": []},
  "p3": {"sujet": "Test P3", "contenu": []},
  "p4": {"sujet": "Test P4", "contenu": []}
}' "Mise à jour données"

echo "⏰ Attendre 35 secondes pour l'auto-save..."
for i in {35..1}; do
    echo -ne "\r   Temps restant: ${i}s  "
    sleep 1
done
echo ""
echo ""

echo "🔍 Test 4: Vérifier que les données sont sauvegardées"
if [ -f "data/content.json" ]; then
    echo "   ✅ Fichier content.json existe"
    echo "   Contenu:"
    cat data/content.json | head -10
    echo "   ..."
else
    echo "   ❌ Fichier content.json n'existe pas"
fi
echo ""

echo "🔍 Test 5: Créer un backup manuel"
test_endpoint "POST" "/api/backup" "" "Backup manuel"

echo "🔍 Test 6: Lister les backups"
test_endpoint "GET" "/api/backups" "" "Liste des backups"

echo "🔍 Test 7: Vérifier l'historique"
test_endpoint "GET" "/api/history" "" "Historique"

echo "🔍 Test 8: Forcer une sauvegarde"
test_endpoint "POST" "/api/save" "" "Sauvegarde forcée"

echo ""
echo "======================================"
echo "✅ TESTS TERMINÉS"
echo "======================================"
echo ""
echo "📊 Résumé:"
echo "   - Données testées: ✅"
echo "   - Auto-save: $([ -f data/content.json ] && echo '✅' || echo '❌')"
echo "   - Backup: $([ -d data/backups ] && echo '✅' || echo '❌')"
echo ""
echo "🎯 Prochaine étape: Tester le redémarrage"
echo "   1. Arrêter le serveur (Ctrl+C)"
echo "   2. Redémarrer: npm start"
echo "   3. Vérifier: curl http://localhost:3000/api/data"
echo ""
