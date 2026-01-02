const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" } // Autorise tout le monde à se connecter
});

// --- CONFIGURATION ---
const SEUIL_VALIDATION = 3; // Il faut 3 votes pour confirmer (Passer au ROUGE)
const DUREE_EVENT = 20 * 60 * 1000; // L'événement reste 20 min
const SPAM_COOLDOWN = 30 * 60 * 1000; // 30 minutes d'attente par map par personne

// --- GAME DATA ---
const MAPS = [
    "Dam Battlegrounds",
    "Buried City",
    "The Spaceport",
    "The Blue Gate",
    "Stella Montis"
];

const EVENTS = [
    "No Active Event (Clear Map)", // Pour dire qu'il n'y a rien
    "Matriarch (World Boss)",
    "Harvester (Queen)",
    "Hidden Bunker (Collab Event)",
    "Cold Snap",
    "Night Raid",
    "Magnetic Storm",
    "Prospecting Probes",
    "Raider Caches",
    "Wreckage Graveyard",
    "Harvest Season"
];

// --- ÉTAT DU JEU ---
let gameState = {};
// Structure pour l'anti-spam : rateLimits[IP][MapName] = Timestamp
let rateLimits = {}; 

// Initialisation
MAPS.forEach(map => {
    gameState[map] = { event: null, votes: 0, confirmed: false, timer: null };
});

app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true); // Important pour récupérer la vraie IP sur Render

io.on('connection', (socket) => {
    // Récupérer l'IP du joueur (Compatible Render/Localhost)
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    // 1. Envoyer l'état actuel à la connexion
    socket.emit('init_state', gameState);
    socket.emit('setup_data', { maps: MAPS, events: EVENTS });

    // 2. Recevoir un signalement
    socket.on('report_event', (data) => {
        const { map, eventName } = data;
        
        // Sécurité basique
        if (!gameState[map]) return;

        // --- VÉRIFICATION ANTI-SPAM (30 MIN PAR MAP) ---
        if (!rateLimits[clientIp]) rateLimits[clientIp] = {};
        
        const lastReportTime = rateLimits[clientIp][map];
        const now = Date.now();

        if (lastReportTime && (now - lastReportTime < SPAM_COOLDOWN)) {
            // Calcul du temps restant
            const minutesLeft = Math.ceil((SPAM_COOLDOWN - (now - lastReportTime)) / 60000);
            socket.emit('error_message', `You must wait ${minutesLeft} min before reporting on ${map} again.`);
            return; // On arrête tout, le vote ne compte pas
        }

        // Si c'est bon, on enregistre l'heure du vote pour cette map
        rateLimits[clientIp][map] = now;

        // --- TRAITEMENT DU VOTE ---
        console.log(`Vote reçu de ${clientIp} sur ${map} pour ${eventName}`);
        
        const currentData = gameState[map];

        // Si l'événement change (ou si c'était "Clear")
        if (currentData.event !== eventName) {
            // Si l'event actuel n'était pas confirmé, on l'écrase
            if (!currentData.confirmed) {
                currentData.event = eventName;
                currentData.votes = 1;
                currentData.confirmed = false;
            } else {
                // Si un event est déjà confirmé, il faut beaucoup de votes pour le changer (optionnel, ici on simplifie)
                // Pour l'instant on garde la logique simple : un nouvel event écrase l'ancien si confirmé ? 
                // Non, on va dire qu'on ajoute un vote pour le NOUVEL event.
                // Simplification pour ton MVP : Si c'est différent, on reset et on met 1 vote
                currentData.event = eventName;
                currentData.votes = 1;
                currentData.confirmed = false;
            }
        } else {
            // C'est le même événement, on ajoute un vote
            // On ne peut pas voter plus que le seuil une fois confirmé pour éviter les chiffres fous
            if (currentData.votes < SEUIL_VALIDATION + 10) { 
                currentData.votes += 1;
            }
        }

        // --- VALIDATION (Passage en ROUGE) ---
        if (currentData.votes >= SEUIL_VALIDATION) {
            currentData.confirmed = true;
            
            // Gestion du Timer
            if (currentData.timer) clearTimeout(currentData.timer);
            
            // Si ce n'est pas "Clear Map", on met un timer pour nettoyer plus tard
            if (eventName !== "No Active Event (Clear Map)") {
                currentData.timer = setTimeout(() => {
                    resetMap(map);
                }, DUREE_EVENT);
            }
        }

        // IMPORTANT : On envoie la mise à jour à TOUT LE MONDE immédiatement
        io.emit('update_state', gameState);
        socket.emit('success_message', `Report registered for ${map}!`);
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
    console.log(`Server running on port ${PORT}`);
});
