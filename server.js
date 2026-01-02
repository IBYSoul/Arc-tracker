const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuration essentielle pour récupérer la vraie IP sur Render
app.set('trust proxy', true);

const io = new Server(server, {
    cors: { origin: "*" } // Autorise les connexions de partout
});

// --- CONFIGURATION ---
const SEUIL_VALIDATION = 3; // 3 votes pour confirmer
const DUREE_EVENT = 20 * 60 * 1000; // Reset après 20 min
const SPAM_COOLDOWN = 30 * 60 * 1000; // 30 min d'attente par map

// --- GAME DATA (English) ---
const MAPS = [
    "Dam Battlegrounds",
    "Buried City",
    "The Spaceport",
    "The Blue Gate",
    "Stella Montis"
];

const EVENTS = [
    "No Active Event (Clear Map)",
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

// --- STATE ---
let gameState = {};
let rateLimits = {}; 

// Init
MAPS.forEach(map => {
    gameState[map] = { event: null, votes: 0, confirmed: false, timer: null };
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    // Récupération IP
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    socket.emit('init_state', gameState);
    socket.emit('setup_data', { maps: MAPS, events: EVENTS });

    socket.on('report_event', (data) => {
        const { map, eventName } = data;
        if (!gameState[map]) return;

        // --- ANTI-SPAM CHECK ---
        if (!rateLimits[clientIp]) rateLimits[clientIp] = {};
        const lastReportTime = rateLimits[clientIp][map];
        const now = Date.now();

        if (lastReportTime && (now - lastReportTime < SPAM_COOLDOWN)) {
            const minutesLeft = Math.ceil((SPAM_COOLDOWN - (now - lastReportTime)) / 60000);
            socket.emit('error_message', `Wait ${minutesLeft} min before reporting on ${map} again.`);
            return;
        }

        // Validate Vote
        rateLimits[clientIp][map] = now;
        
        const currentData = gameState[map];

        if (currentData.event !== eventName) {
            if (!currentData.confirmed) {
                currentData.event = eventName;
                currentData.votes = 1;
                currentData.confirmed = false;
            }
        } else {
            if (currentData.votes < SEUIL_VALIDATION + 10) {
                currentData.votes += 1;
            }
        }

        if (currentData.votes >= SEUIL_VALIDATION) {
            currentData.confirmed = true;
            
            if (currentData.timer) clearTimeout(currentData.timer);
            
            // Si ce n'est pas "Clear Map", on lance le timer de fin d'event
            if (eventName !== "No Active Event (Clear Map)") {
                currentData.timer = setTimeout(() => {
                    resetMap(map);
                }, DUREE_EVENT);
            }
        }

        io.emit('update_state', gameState);
        socket.emit('success_message', `Report for ${map} received.`);
    });
});

function resetMap(mapName) {
    if (gameState[mapName]) {
        gameState[mapName] = { event: null, votes: 0, confirmed: false, timer: null };
        io.emit('update_state', gameState);
    }
}

const PORT = process.env.PORT || 3000;

// --- MODIFICATION CRITIQUE ICI ---
// On ajoute '0.0.0.0' pour écouter toutes les connexions externes
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
