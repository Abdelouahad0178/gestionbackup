// script.js - Version 2.1 - Migration automatique et logique de vente par lots

// Structure de données par défaut
let pharmaData = {
    metadata: {
        societeName: "PHARMACIE",
        version: "2.1-Lots",
        appName: "Pharma Gestion",
    },
    data: {
        achats: [],
        ventes: [],
        stock: [],      // Catalogue de produits (nom, prix, seuil)
        lots: [],       // UNIQUE source de vérité pour les quantités
        mouvements: [],
        devisFactures: [],
        paiements: [],
        retours: [],
        users: [],
        societeInfo: { nom: "PHARMACIE" }
    },
    statistics: {}
};

// Initialisation de l'application
document.addEventListener('DOMContentLoaded', function() {
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => input.value = today);
    addArticleAchat();
    addArticleVente();
    updateDisplay();
});

// Gestion de l'import de fichier JSON avec migration
document.getElementById('jsonFileInput').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/json') {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                pharmaData = JSON.parse(e.target.result);
                
                // === MIGRATION AUTOMATIQUE DES DONNÉES ===
                if (!pharmaData.data.lots || pharmaData.data.lots.length === 0) {
                    showNotification('Migration des lots en cours...', 'info');
                    pharmaData.data.lots = [];
                    
                    (pharmaData.data.achats || []).forEach(achat => {
                        (achat.articles || []).forEach(article => {
                            if (article.produit && article.numeroLot && article.quantite) {
                                findOrCreateProductInCatalog(article.produit, {
                                    prixAchat: article.prixAchat,
                                    prixVente: article.prixVente
                                });
                                addOrUpdateLot({
                                    produit: article.produit,
                                    numeroLot: article.numeroLot,
                                    quantite: article.quantite,
                                    datePeremption: article.datePeremption,
                                    prixAchat: article.prixAchat,
                                    prixVente: article.prixVente,
                                    fournisseur: achat.fournisseur || article.fournisseurArticle
                                }, achat.id);
                            }
                        });
                    });
                    showNotification('Migration des lots terminée !', 'success');
                }
                
                recalculateAllStockQuantities();
                if (!pharmaData.data.mouvements) pharmaData.data.mouvements = [];
                
                updateDisplay();
                showNotification('Données importées avec succès !', 'success');
            } catch (error) {
                showNotification('Erreur d\'importation: ' + error.message, 'error');
                console.error("Erreur parsing JSON:", error);
            }
        };
        reader.readAsText(file);
    }
});


// Navigation
function showSection(sectionName) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(sectionName).classList.add('active');
    event.currentTarget.classList.add('active');
    updateAllTables();
}

// Modales
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'block';
    if (modalId === 'venteModal') {
        populateVenteProductSelects();
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'none';
    modal.removeAttribute('data-edit-id');
    modal.querySelectorAll('form').forEach(form => form.reset());
    const today = new Date().toISOString().split('T')[0];
    modal.querySelectorAll('input[type="date"]').forEach(input => input.value = today);
    document.querySelectorAll('#achat-articles, #vente-articles').forEach(container => {
        container.innerHTML = '';
        if (container.id === 'achat-articles') addArticleAchat();
        if (container.id === 'vente-articles') addArticleVente();
    });
}
window.onclick = (event) => { if (event.target.classList.contains('modal')) closeModal(event.target.id); };

// Mises à jour de l'affichage
function updateDisplay() {
    updateHeaderInfo();
    updateAllTables();
}

function updateHeaderInfo() {
    const metadata = pharmaData.metadata || {};
    const data = pharmaData.data || {};
    document.getElementById('societeName').textContent = metadata.societeName || 'N/A';
    const totalDocs = Object.values(data).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    document.getElementById('totalDocs').textContent = totalDocs;
    document.getElementById('exportDate').textContent = formatDate(metadata.exportDateIso || Date.now());
    document.getElementById('appVersion').textContent = metadata.version || '2.1';
}

function updateAllTables() {
    const activeSectionId = document.querySelector('.content-section.active')?.id;
    if (!activeSectionId) return;
    switch (activeSectionId) {
        case 'dashboard': updateDashboard(); break;
        case 'achats': updateAchatsTable(); break;
        case 'ventes': updateVentesTable(); break;
        case 'stock': updateStockTable(); break;
        case 'lots': updateLotsTable(); break;
    }
}

// ===============================================
// == SYSTÈME DE GESTION PAR LOTS (CŒUR) ==
// ===============================================

function findOrCreateProductInCatalog(productName, defaults = {}) {
    let product = pharmaData.data.stock.find(p => p.nom.toLowerCase() === productName.toLowerCase());
    if (!product) {
        product = {
            id: generateId(),
            nom: productName,
            seuil: defaults.seuil || 5,
            prixAchat: defaults.prixAchat || 0,
            prixVente: defaults.prixVente || 0,
            creeLe: new Date().toISOString(),
        };
        pharmaData.data.stock.push(product);
    } else {
        if (defaults.prixAchat) product.prixAchat = defaults.prixAchat;
        if (defaults.prixVente) product.prixVente = defaults.prixVente;
    }
    return product;
}

function addOrUpdateLot(lotData, reference) {
    let lot = pharmaData.data.lots.find(l => l.numeroLot.toLowerCase() === lotData.numeroLot.toLowerCase() && l.produit.toLowerCase() === lotData.produit.toLowerCase());
    const stockAvant = lot ? lot.quantite : 0;
    if (lot) {
        lot.quantite += lotData.quantite;
        lot.quantiteInitiale += lotData.quantite;
        lot.modifieLe = new Date().toISOString();
        if (lot.statut === 'epuise') lot.statut = 'actif';
    } else {
        lot = {
            id: generateId(), ...lotData,
            quantiteInitiale: lotData.quantite,
            statut: 'actif',
            creeLe: new Date().toISOString(),
            reference: reference,
        };
        pharmaData.data.lots.push(lot);
    }
    createStockMovement(lot.produit, 'entree', lotData.quantite, stockAvant, lot.quantite, reference, `Achat - Lot ${lot.numeroLot}`);
}

/**
 * Prélève une quantité demandée des lots disponibles pour un produit.
 * Utilise la stratégie FEFO (First Expired, First Out).
 * C'EST LA FONCTION CLÉ POUR LA LOGIQUE DE VENTE.
 * @returns Un objet avec les prélèvements effectués et la quantité manquante.
 */
function takeFromLots(productName, quantityNeeded, reference) {
    const availableLots = pharmaData.data.lots
        .filter(l => l.produit.toLowerCase() === productName.toLowerCase() && l.quantite > 0)
        .sort((a, b) => new Date(a.datePeremption) - new Date(b.datePeremption));

    let remainingNeeded = quantityNeeded;

    for (const lot of availableLots) {
        if (remainingNeeded <= 0) break;
        
        const take = Math.min(lot.quantite, remainingNeeded);
        
        const stockAvant = lot.quantite;
        lot.quantite -= take;
        remainingNeeded -= take;
        
        if (lot.quantite <= 0) {
            lot.statut = 'epuise';
        }

        createStockMovement(productName, 'sortie', take, stockAvant, lot.quantite, reference, `Vente - Lot ${lot.numeroLot}`);
    }

    return { missing: remainingNeeded };
}

function getStockTotalFromLots(productName) {
    return pharmaData.data.lots
        .filter(l => l.produit.toLowerCase() === productName.toLowerCase() && l.quantite > 0)
        .reduce((sum, l) => sum + l.quantite, 0);
}

function recalculateAllStockQuantities() {
    (pharmaData.data.stock || []).forEach(p => {
        p.quantite = getStockTotalFromLots(p.nom);
    });
}

// === Section Achats ===
function updateAchatsTable() {
    const tbody = document.getElementById('achatsTableBody');
    tbody.innerHTML = '';
    (pharmaData.data.achats || []).forEach(achat => {
        const total = (achat.articles || []).reduce((sum, art) => sum + ((art.prixAchat || 0) * (art.quantite || 0)), 0);
        tbody.innerHTML += `<tr><td>${formatDate(achat.date)}</td><td>${achat.fournisseur}</td><td>${(achat.articles || []).length}</td><td>${total.toFixed(2)} dhs</td><td><span class="status-badge status-${achat.statutPaiement}">${achat.statutPaiement}</span></td><td>${achat.creeParEmail || 'N/A'}</td><td><button class="btn btn-danger btn-sm" onclick="deleteAchat('${achat.id}')"><i class="fas fa-trash"></i></button></td></tr>`;
    });
}

function addArticleAchat() {
    const container = document.getElementById('achat-articles');
    const item = document.createElement('div');
    item.className = 'article-item';
    item.innerHTML = `<div class="form-row"><div class="form-group"><label>Produit:</label><input type="text" class="article-produit" required></div><div class="form-group"><label>N° Lot:</label><input type="text" class="article-lot" required></div></div><div class="form-row"><div class="form-group"><label>Quantité:</label><input type="number" class="article-quantite" min="1" required></div><div class="form-group"><label>Prix Achat:</label><input type="number" class="article-prix-achat" step="0.01" required></div><div class="form-group"><label>Prix Vente:</label><input type="number" class="article-prix-vente" step="0.01" required></div></div><div class="form-group"><label>Date Péremption:</label><input type="date" class="article-peremption" required></div><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">Supprimer</button>`;
    container.appendChild(item);
}

function saveAchat() {
    const achatId = generateId();
    const articles = [];
    document.querySelectorAll('#achat-articles .article-item').forEach(item => {
        const produitNom = item.querySelector('.article-produit').value;
        const quantite = parseInt(item.querySelector('.article-quantite').value);
        if (produitNom && quantite > 0) {
            const articleData = {
                produit: produitNom,
                numeroLot: item.querySelector('.article-lot').value,
                quantite: quantite,
                prixAchat: parseFloat(item.querySelector('.article-prix-achat').value),
                prixVente: parseFloat(item.querySelector('.article-prix-vente').value),
                datePeremption: item.querySelector('.article-peremption').value,
                fournisseur: document.getElementById('achat-fournisseur').value
            };
            articles.push(articleData);
            findOrCreateProductInCatalog(articleData.produit, { prixAchat: articleData.prixAchat, prixVente: articleData.prixVente });
            addOrUpdateLot(articleData, achatId);
        }
    });
    if (articles.length === 0) return showNotification('Veuillez ajouter au moins un article valide.', 'error');
    pharmaData.data.achats.push({
        id: achatId,
        date: document.getElementById('achat-date').value,
        fournisseur: document.getElementById('achat-fournisseur').value,
        statutPaiement: document.getElementById('achat-statut').value,
        articles: articles,
        creeLe: new Date().toISOString(),
        creeParEmail: pharmaData.metadata.exportedBy
    });
    showNotification(`Achat enregistré. ${articles.length} lot(s) mis à jour.`, 'success');
    updateDisplay();
    closeModal('achatModal');
}

function deleteAchat(id) {
    showNotification('La suppression d\'achat n\'est pas supportée pour garantir la traçabilité. Veuillez créer un retour fournisseur.', 'warning');
}

// === Section Ventes ===
function updateVentesTable() {
    const tbody = document.getElementById('ventesTableBody');
    tbody.innerHTML = '';
    (pharmaData.data.ventes || []).forEach(vente => {
        tbody.innerHTML += `<tr><td>${formatDate(vente.date)}</td><td>${vente.client}</td><td>${(vente.articles || []).length}</td><td>${(vente.montantTotal || 0).toFixed(2)} dhs</td><td>${vente.modePaiement}</td><td><span class="status-badge status-${vente.statutPaiement}">${vente.statutPaiement}</span></td><td><button class="btn btn-danger btn-sm" onclick="deleteVente('${vente.id}')"><i class="fas fa-trash"></i></button></td></tr>`;
    });
}

function populateVenteProductSelects() {
    const selects = document.querySelectorAll('#vente-articles .article-produit');
    selects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Choisir un produit...</option>';
        pharmaData.data.stock.forEach(p => {
            const stockTotal = getStockTotalFromLots(p.nom);
            if (stockTotal > 0) {
                select.innerHTML += `<option value="${p.nom}" ${currentValue === p.nom ? 'selected' : ''}>${p.nom} (${stockTotal} dispo.)</option>`;
            }
        });
    });
}

function onVenteProductSelect(selectElement) {
    const articleItem = selectElement.closest('.article-item');
    const produitNom = selectElement.value;
    const prixInput = articleItem.querySelector('.article-prix-unitaire');
    const stockInfo = articleItem.querySelector('.stock-info');
    if (produitNom) {
        const product = pharmaData.data.stock.find(p => p.nom === produitNom);
        prixInput.value = product.prixVente || 0;
        stockInfo.textContent = `Stock disponible : ${getStockTotalFromLots(produitNom)}`;
        stockInfo.style.display = 'block';
    } else {
        prixInput.value = '';
        stockInfo.style.display = 'none';
    }
}

function addArticleVente() {
    const container = document.getElementById('vente-articles');
    const item = document.createElement('div');
    item.className = 'article-item';
    item.innerHTML = `<div class="form-row"><div class="form-group"><label>Produit:</label><select class="article-produit" onchange="onVenteProductSelect(this)" required></select></div><div class="form-group"><label>Quantité:</label><input type="number" class="article-quantite" value="1" min="1" required></div></div><div class="form-row"><div class="form-group"><label>Prix Unitaire:</label><input type="number" class="article-prix-unitaire" step="0.01" required></div><div class="form-group"><label>Remise (%):</label><input type="number" class="article-remise" value="0" min="0"></div></div><div class="stock-info" style="display: none;"></div><button type="button" class="btn btn-danger" onclick="this.parentElement.remove()">Supprimer</button>`;
    container.appendChild(item);
    populateVenteProductSelects();
}

/**
 * C'est la fonction principale qui gère la logique de vente,
 * incluant la vérification du stock des lots et le prélèvement.
 */
function saveVente() {
    const venteId = generateId();
    let montantTotal = 0;
    const articles = [];
    let hasStockError = false;

    document.querySelectorAll('#vente-articles .article-item').forEach(item => {
        const produitNom = item.querySelector('.article-produit').value;
        const quantite = parseInt(item.querySelector('.article-quantite').value);
        const prixUnitaire = parseFloat(item.querySelector('.article-prix-unitaire').value);
        const remise = parseFloat(item.querySelector('.article-remise').value) || 0;
        
        if (produitNom && quantite > 0) {
            // 1. VÉRIFICATION DU STOCK DANS LES LOTS
            const stockDispo = getStockTotalFromLots(produitNom);
            if (quantite > stockDispo) {
                showNotification(`Stock insuffisant pour ${produitNom} ! Demandé: ${quantite}, Dispo: ${stockDispo}`, 'error');
                hasStockError = true;
                return;
            }
            const totalLigne = quantite * prixUnitaire * (1 - remise / 100);
            montantTotal += totalLigne;
            articles.push({ produit: produitNom, quantite, prixUnitaire, remise });
        }
    });

    if (hasStockError || articles.length === 0) return;

    // 2. PRÉLÈVEMENT DES LOTS (Logique FEFO)
    articles.forEach(article => {
        takeFromLots(article.produit, article.quantite, venteId);
    });

    // 3. ENREGISTREMENT DE LA VENTE
    const newVente = {
        id: venteId,
        date: document.getElementById('vente-date').value,
        client: document.getElementById('vente-client').value,
        modePaiement: document.getElementById('vente-mode').value,
        statutPaiement: document.getElementById('vente-statut').value,
        notes: document.getElementById('vente-notes').value,
        articles: articles,
        montantTotal: montantTotal,
        creeLe: new Date().toISOString(),
        createdBy: pharmaData.metadata.exportedBy
    };
    pharmaData.data.ventes.push(newVente);

    showNotification('Vente enregistrée avec succès. Stock mis à jour.', 'success');
    updateDisplay();
    closeModal('venteModal');
}

function deleteVente(id) {
    showNotification('La suppression de vente n\'est pas supportée pour garantir la traçabilité. Veuillez créer un retour client.', 'warning');
}

// === Section Stock (Vue Résumée) ===
function updateStockTable() {
    const tbody = document.getElementById('stockTableBody');
    tbody.innerHTML = '';
    (pharmaData.data.stock || []).forEach(produit => {
        const quantite = getStockTotalFromLots(produit.nom);
        const seuil = produit.seuil || 0;
        let rowClass = '';
        if (quantite <= 0) rowClass = 'out-of-stock';
        else if (quantite <= seuil) rowClass = 'low-stock';
        tbody.innerHTML += `<tr class="${rowClass}"><td>${produit.nom}</td><td><strong>${quantite}</strong></td><td>${seuil}</td><td>${(produit.prixAchat || 0).toFixed(2)} dhs</td><td>${(produit.prixVente || 0).toFixed(2)} dhs</td><td>-</td></tr>`;
    });
}

// === Section Lots (Vue Détaillée) ===
function updateLotsTable() {
    const tbody = document.getElementById('lotsTableBody');
    tbody.innerHTML = '';
    (pharmaData.data.lots || []).forEach(lot => {
        const dateExp = new Date(lot.datePeremption);
        const daysToExpiry = Math.ceil((dateExp - new Date()) / (1000 * 60 * 60 * 24));
        let statusClass = 'status-actif', statusText = 'Actif';
        if (lot.quantite <= 0) { statusClass = 'status-inactif'; statusText = 'Épuisé'; }
        else if (daysToExpiry < 0) { statusClass = 'status-impaye'; statusText = 'Expiré'; }
        else if (daysToExpiry <= 30) { statusClass = 'low-stock'; statusText = 'Expire Bientôt'; }
        tbody.innerHTML += `<tr class="${statusClass}"><td>${lot.produit}</td><td>${lot.numeroLot}</td><td>${lot.quantite} / ${lot.quantiteInitiale}</td><td>${formatDate(lot.datePeremption)} (J${daysToExpiry})</td><td>${lot.fournisseur || 'N/A'}</td><td><span class="status-badge ${statusClass}">${statusText}</span></td><td></td></tr>`;
    });
}

// === Autres fonctions ===
function createStockMovement(produit, type, quantite, stockAvant, stockApres, reference, notes) {
    (pharmaData.data.mouvements || []).unshift({
        id: generateId(), date: new Date().toISOString(), produit, type, quantite, stockAvant, stockApres, reference, notes, creePar: pharmaData.metadata.exportedBy
    });
}

function updateDashboard() {
    const data = pharmaData.data || {};
    document.getElementById('stats-achats').textContent = (data.achats || []).length;
    document.getElementById('stats-ventes').textContent = (data.ventes || []).length;
    document.getElementById('stats-stock').textContent = (data.stock || []).length;
    const totalCA = (data.ventes || []).reduce((sum, v) => sum + (v.montantTotal || 0), 0);
    document.getElementById('stats-ca').textContent = `${totalCA.toFixed(2)} dhs`;
}

// === Fonctions utilitaires ===
function generateId() { return 'id_' + Math.random().toString(36).substring(2, 11); }
function formatDate(dateString) { return dateString ? new Date(dateString).toLocaleDateString('fr-FR') : '-'; }

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `position: fixed; top: 20px; right: 20px; padding: 15px; border-radius: 5px; color: white; z-index: 1001; transition: opacity 0.5s, transform 0.5s; opacity: 0; transform: translateX(100%);`;
    switch(type) {
        case 'success': notification.style.backgroundColor = '#4CAF50'; break;
        case 'error': notification.style.backgroundColor = '#f44336'; break;
        case 'warning': notification.style.backgroundColor = '#ff9800'; break;
        default: notification.style.backgroundColor = '#2196F3'; break;
    }
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = 1;
        notification.style.transform = 'translateX(0)';
    }, 10);
    setTimeout(() => {
        notification.style.opacity = 0;
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 500);
    }, 4000);
}

function exportData() {
    pharmaData.metadata.exportDateIso = new Date().toISOString();
    const dataStr = JSON.stringify(pharmaData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pharma-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Exportation réussie !', 'success');
}

function resetData() {
    if (confirm('Voulez-vous vraiment tout réinitialiser ?')) {
        const initialMetadata = { ...pharmaData.metadata };
        pharmaData = {
            metadata: initialMetadata,
            data: { achats: [], ventes: [], stock: [], lots: [], mouvements: [], devisFactures:[], paiements:[], retours:[], users:[], societeInfo:{...pharmaData.data.societeInfo} },
            statistics: {}
        };
        updateDisplay();
        showNotification('Données réinitialisées.', 'success');
    }
}