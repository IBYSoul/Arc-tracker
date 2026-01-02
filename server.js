const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION ---
const SEUIL_VALIDATION = 3; // 3 votes identiques valident l'event
const DUREE_EVENT = 20 * 60 * 1000; // Un event reste affiché 20 minutes par défaut

// --- DONNÉES DU JEU (Mises à jour avec tes infos) ---
const MAPS = [
    "Dam Battlegrounds",
    "Buried City",
    "The Spaceport",
    "The Blue Gate",
    "Stella Montis"
];

const EVENTS = [
    // Événements Majeurs / Boss
    "Matriarche (World Boss)",
    "Récolteur (La Reine)",
    "Bunker Caché (Event Collaboratif)",
    "Vague de Froid",
    "Raid Nocturne",
    "Tempête Électromagnétique",
    
    // Événements Mineurs / Environnement
    "Sondes de prospection",
    "Caches de raider",
    "Cimetière d'épaves",
    "Saison des récoltes"
];

// --- ÉTAT DU JEU (Mémoire) ---
let gameState = {};

// Initialisation
MAPS.forEach(map => {
    gameState[map] = { event: null, votes: 0, confirmed: false, timer: null };
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    // 1. Envoyer l'état actuel au nouveau venu
    socket.emit('init_state', gameState);
    
    // 2. Envoyer la liste des maps/events pour remplir les menus
    socket.emit('setup_data', { maps: MAPS, events: EVENTS });

    // 3. Recevoir un signalement
    socket.on('report_event', (data) => {
        const { map, eventName } = data;
        if (!gameState[map]) return;

        const currentData = gameState[map];

        // Si l'event change ou si c'est le premier vote
        if (currentData.event !== eventName) {
            if (!currentData.confirmed) {
                currentData.event = eventName;
                currentData.votes = 1;
                currentData.confirmed = false; // Reset de la confirmation
            }
        } else {
            // Même event, on ajoute un vote si pas déjà confirmé
            if (!currentData.confirmed) {
                currentData.votes += 1;
            }
        }

        // Validation si seuil atteint
        if (currentData.votes >= SEUIL_VALIDATION && !currentData.confirmed) {
            currentData.confirmed = true;
            
            // Timer d'expiration
            if (currentData.timer) clearTimeout(currentData.timer);
            currentData.timer = setTimeout(() => {
                resetMap(map);
            }, DUREE_EVENT);
        }

        // Diffusion à tout le monde
        io.emit('update_state', gameState);
    });
});

function resetMap(mapName) {
    if (gameState[mapName]) {
        gameState[mapName] = { event: null, votes: 0, confirmed: false, timer: null };
        io.emit('update_state', gameState);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur ARC Tracker lancé sur le port ${PORT}`);
});