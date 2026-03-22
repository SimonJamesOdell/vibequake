import { randomUUID } from 'node:crypto';
export class MultiplayerManager {
    static MAX_PLAYERS_PER_WORLD = 4;
    static STALE_CLIENT_TIMEOUT_MS = 12000;
    static PREVIEW_SYNC_INTERVAL_MS = 250;
    static PING_INTERVAL_MS = 2000;
    static INPUT_REORDER_BASE_MS = 24;
    static INPUT_REORDER_MAX_MS = 140;
    static INPUT_BUFFER_LIMIT = 64;
    options;
    cheatsAllowed = process.env.NODE_ENV !== 'production';
    rooms = new Map();
    clients = new Map();
    roomCountersByMap = new Map();
    directorySubscribers = new Set();
    mapPreviewSubscriptions = new Map();
    lastPreviewSyncAt = 0;
    constructor(options) {
        this.options = options;
    }
    handleConnection(ws) {
        console.log('[Multiplayer] New client connected');
        this.directorySubscribers.add(ws);
        this.sendWorldDirectory(ws);
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                void this.handleClientMessage(ws, message);
            }
            catch (error) {
                console.error('[Multiplayer] Invalid message:', error);
            }
        });
        ws.on('close', () => {
            this.handleDisconnection(ws);
        });
        ws.on('error', (error) => {
            console.error('[Multiplayer] WebSocket error:', error);
        });
    }
    async handleClientMessage(ws, message) {
        const client = this.clients.get(ws);
        if (client) {
            client.lastUpdate = Date.now();
        }
        switch (message.type) {
            case 'join':
                await this.handleJoin(ws, message.payload);
                break;
            case 'leave-world':
                if (client)
                    this.handleLeaveWorld(client);
                break;
            case 'subscribe-world-directory':
                this.sendWorldDirectory(ws);
                break;
            case 'subscribe-map-preview':
                this.mapPreviewSubscriptions.set(ws, message.payload.mapId);
                this.sendMapPreviewState(ws, message.payload.mapId);
                break;
            case 'net-pong':
                if (client)
                    this.handleNetPong(client, message.payload);
                break;
            case 'input':
                if (client)
                    this.handleInput(client, message.payload);
                break;
            case 'shoot':
                if (client)
                    this.handleShoot(client, message.payload);
                break;
            case 'damage-enemy':
                if (client)
                    this.handleDamageEnemy(client, message.payload);
                break;
            case 'collect-pickup':
                if (client)
                    this.handleCollectPickup(client, message.payload);
                break;
            case 'set-invulnerable':
                if (client)
                    this.handleSetInvulnerable(client, message.payload);
                break;
            case 'death':
                if (client)
                    this.handleDeath(client, message.payload);
                break;
            case 'respawn':
                if (client)
                    this.handleRespawn(client);
                break;
        }
    }
    async handleJoin(ws, payload) {
        const playerId = randomUUID();
        const room = await this.getOrCreateRoom(payload.mapId);
        // Create client
        const client = {
            id: randomUUID(),
            ws,
            playerId,
            roomId: room.id,
            name: payload.name || 'Player',
            lastUpdate: Date.now(),
            lastInputSeq: 0,
            pendingInputs: new Map(),
            lastPingAt: 0,
            lastPongAt: 0,
            rttMs: 0,
            jitterMs: 0,
            outOfOrderInputs: 0,
            droppedInputGaps: 0,
        };
        this.clients.set(ws, client);
        room.clients.set(client.id, client);
        // Generate distributed spawn position for this player
        const spawnPosition = this.generatePlayerSpawn(room, Object.keys(room.state.players).length);
        // Create player state
        const player = {
            id: playerId,
            name: client.name,
            position: spawnPosition,
            yaw: this.calculateSpawnYaw(spawnPosition, room.bounds),
            pitch: 0,
            health: 100,
            weaponTier: 0,
            invulnerable: false,
            isDead: false,
            score: 0,
        };
        room.state.players[playerId] = player;
        // Send welcome message with full room state
        this.send(ws, {
            type: 'welcome',
            payload: {
                playerId,
                room: this.buildVisibleRoomState(room.state),
            },
        });
        // Notify other players
        this.broadcast(room, {
            type: 'player-joined',
            payload: { player },
        }, client.id);
        this.broadcastWorldDirectory();
        console.log(`[Multiplayer] Player ${client.name} joined room ${room.id}`);
    }
    async getOrCreateRoom(mapId) {
        const candidates = Array.from(this.rooms.values())
            .filter((room) => room.mapId === mapId && room.clients.size < MultiplayerManager.MAX_PLAYERS_PER_WORLD)
            .sort((left, right) => left.state.startedAt - right.state.startedAt);
        if (candidates.length > 0) {
            return candidates[0];
        }
        const roomCounter = this.roomCountersByMap.get(mapId) ?? 0;
        const nextCounter = roomCounter + 1;
        this.roomCountersByMap.set(mapId, nextCounter);
        const roomId = `room-${mapId}-${nextCounter}`;
        const bootstrap = await this.options.resolveBootstrap(mapId);
        const room = this.createRoom(roomId, mapId, bootstrap);
        this.rooms.set(roomId, room);
        this.broadcastWorldDirectory();
        return room;
    }
    handleInput(client, payload) {
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        const player = room.state.players[client.playerId];
        if (!player || player.isDead)
            return;
        if (typeof payload.inputSeq !== 'number') {
            this.applyInputToPlayer(room, client, player, payload);
            return;
        }
        if (payload.inputSeq <= client.lastInputSeq) {
            return;
        }
        if (payload.inputSeq > client.lastInputSeq + 1) {
            client.outOfOrderInputs += 1;
        }
        client.pendingInputs.set(payload.inputSeq, {
            ...payload,
            receivedAt: Date.now(),
        });
        if (client.pendingInputs.size > MultiplayerManager.INPUT_BUFFER_LIMIT) {
            const sortedSeq = Array.from(client.pendingInputs.keys()).sort((left, right) => left - right);
            const overflow = sortedSeq.length - MultiplayerManager.INPUT_BUFFER_LIMIT;
            for (let index = 0; index < overflow; index += 1) {
                client.pendingInputs.delete(sortedSeq[index]);
            }
        }
        this.flushPendingInputs(room, client, player);
    }
    applyInputToPlayer(room, client, player, payload) {
        player.position = payload.position;
        player.yaw = payload.yaw;
        player.pitch = payload.pitch;
        client.lastUpdate = Date.now();
        this.broadcast(room, {
            type: 'player-update',
            payload: {
                playerId: client.playerId,
                state: {
                    position: payload.position,
                    yaw: payload.yaw,
                    pitch: payload.pitch,
                },
            },
        }, client.id);
    }
    flushPendingInputs(room, client, player) {
        const now = Date.now();
        const graceMs = this.getReorderGraceMs(client);
        while (true) {
            const nextExpected = client.lastInputSeq + 1;
            const contiguous = client.pendingInputs.get(nextExpected);
            if (contiguous) {
                client.pendingInputs.delete(nextExpected);
                this.applyInputToPlayer(room, client, player, contiguous);
                client.lastInputSeq = nextExpected;
                continue;
            }
            if (client.pendingInputs.size === 0) {
                break;
            }
            const sortedSeq = Array.from(client.pendingInputs.keys()).sort((left, right) => left - right);
            const earliestSeq = sortedSeq[0];
            const earliestInput = client.pendingInputs.get(earliestSeq);
            if (!earliestInput) {
                break;
            }
            if (earliestInput.receivedAt + graceMs > now) {
                break;
            }
            // Gap is too old, skip missing sequences and continue simulation.
            if (earliestSeq > nextExpected) {
                client.droppedInputGaps += earliestSeq - nextExpected;
            }
            client.pendingInputs.delete(earliestSeq);
            this.applyInputToPlayer(room, client, player, earliestInput);
            client.lastInputSeq = earliestSeq;
        }
    }
    getReorderGraceMs(client) {
        const adaptive = MultiplayerManager.INPUT_REORDER_BASE_MS + Math.min(client.rttMs * 0.25 + client.jitterMs, 90);
        return Math.max(MultiplayerManager.INPUT_REORDER_BASE_MS, Math.min(MultiplayerManager.INPUT_REORDER_MAX_MS, adaptive));
    }
    handleNetPong(client, payload) {
        const now = Date.now();
        const sampleRtt = Math.max(0, now - payload.sentAt);
        const previousRtt = client.rttMs > 0 ? client.rttMs : sampleRtt;
        client.rttMs = client.rttMs === 0 ? sampleRtt : client.rttMs * 0.8 + sampleRtt * 0.2;
        const deviation = Math.abs(sampleRtt - previousRtt);
        client.jitterMs = client.jitterMs === 0 ? deviation : client.jitterMs * 0.8 + deviation * 0.2;
        client.lastPongAt = now;
    }
    handleShoot(client, payload) {
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        const projectile = {
            id: randomUUID(),
            playerId: client.playerId,
            position: payload.position,
            direction: payload.direction,
            tier: payload.tier,
            createdAt: Date.now(),
        };
        // Broadcast projectile to all clients
        this.broadcast(room, {
            type: 'projectile-spawn',
            payload: { projectile },
        });
    }
    handleDamageEnemy(client, payload) {
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        const enemy = room.state.enemies[payload.enemyId];
        if (!enemy || enemy.isDead)
            return;
        enemy.health -= payload.damage;
        if (enemy.health <= 0) {
            enemy.health = 0;
            enemy.isDead = true;
            // Update player score
            const player = room.state.players[client.playerId];
            if (player) {
                player.score += 100;
            }
            // Broadcast enemy death
            this.broadcast(room, {
                type: 'enemy-died',
                payload: {
                    enemyId: payload.enemyId,
                    killerId: client.playerId,
                },
            });
            // Schedule respawn (10 seconds)
            room.enemyRespawnQueue.push({
                id: payload.enemyId,
                spawnAt: Date.now() + 10000,
            });
        }
        else {
            // Broadcast health update
            this.broadcast(room, {
                type: 'enemy-update',
                payload: {
                    enemyId: payload.enemyId,
                    state: { health: enemy.health },
                },
            });
        }
    }
    handleCollectPickup(client, payload) {
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        const pickup = room.state.pickups[payload.pickupId];
        if (!pickup || pickup.collected)
            return;
        pickup.collected = true;
        // Update player weapon tier
        const player = room.state.players[client.playerId];
        if (player) {
            player.weaponTier = pickup.tier;
        }
        // Broadcast pickup collection
        this.broadcast(room, {
            type: 'pickup-collected',
            payload: {
                pickupId: payload.pickupId,
                playerId: client.playerId,
            },
        });
    }
    handleSetInvulnerable(client, payload) {
        if (!this.cheatsAllowed) {
            return;
        }
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        const player = room.state.players[client.playerId];
        if (!player)
            return;
        player.invulnerable = payload.invulnerable;
        if (payload.invulnerable) {
            player.health = 100;
            player.isDead = false;
        }
        this.broadcast(room, {
            type: 'player-update',
            payload: {
                playerId: client.playerId,
                state: {
                    invulnerable: player.invulnerable,
                    health: player.health,
                    isDead: player.isDead,
                },
            },
        });
    }
    handleDeath(client, payload) {
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        const player = room.state.players[client.playerId];
        if (!player)
            return;
        player.isDead = true;
        player.health = 0;
        player.score = payload.score;
        this.broadcast(room, {
            type: 'player-update',
            payload: {
                playerId: client.playerId,
                state: { isDead: true, health: 0, score: payload.score },
            },
        });
    }
    handleRespawn(client) {
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        const player = room.state.players[client.playerId];
        if (!player)
            return;
        // Generate new spawn position for respawn
        const playerIndex = Object.keys(room.state.players).indexOf(client.playerId);
        const newSpawn = this.generatePlayerSpawn(room, playerIndex);
        const newYaw = this.calculateSpawnYaw(newSpawn, room.bounds);
        player.isDead = false;
        player.health = 100;
        player.weaponTier = 0;
        player.position = newSpawn;
        player.yaw = newYaw;
        this.broadcast(room, {
            type: 'player-update',
            payload: {
                playerId: client.playerId,
                state: {
                    isDead: false,
                    health: 100,
                    weaponTier: 0,
                    position: newSpawn,
                    yaw: newYaw,
                },
            },
        });
    }
    handleLeaveWorld(client) {
        const room = this.rooms.get(client.roomId);
        if (!room) {
            return;
        }
        this.evictClient(room, client, 'left-world', false);
    }
    handleDisconnection(ws) {
        this.directorySubscribers.delete(ws);
        this.mapPreviewSubscriptions.delete(ws);
        const client = this.clients.get(ws);
        if (!client)
            return;
        const room = this.rooms.get(client.roomId);
        if (room) {
            // Remove player from room
            delete room.state.players[client.playerId];
            room.clients.delete(client.id);
            // Notify other players
            this.broadcast(room, {
                type: 'player-left',
                payload: { playerId: client.playerId },
            });
            // Clean up empty rooms
            if (room.clients.size === 0) {
                this.rooms.delete(client.roomId);
                console.log(`[Multiplayer] Room ${client.roomId} closed (empty)`);
            }
            this.broadcastWorldDirectory();
        }
        this.clients.delete(ws);
        console.log(`[Multiplayer] Player ${client.name} disconnected`);
    }
    evictClient(room, client, reason, closeSocket = true) {
        delete room.state.players[client.playerId];
        room.clients.delete(client.id);
        this.clients.delete(client.ws);
        this.broadcast(room, {
            type: 'player-left',
            payload: { playerId: client.playerId },
        });
        this.broadcastWorldDirectory();
        console.log(`[Multiplayer] Player ${client.name} evicted from ${room.id}: ${reason}`);
        if (room.clients.size === 0) {
            this.rooms.delete(room.id);
            console.log(`[Multiplayer] Room ${room.id} closed (empty)`);
        }
        if (closeSocket && (client.ws.readyState === client.ws.OPEN || client.ws.readyState === client.ws.CONNECTING)) {
            client.ws.close(1000, reason);
        }
    }
    createRoom(roomId, mapId, bootstrap) {
        const pickups = {};
        const isAbyssalFamily = mapId === 'abyssal-grotto' || mapId === 'abyssal-grotto-prime';
        if (isAbyssalFamily) {
            pickups[`${mapId}-pickup-tier-1`] = {
                id: `${mapId}-pickup-tier-1`,
                tier: 1,
                collected: false,
                position: {
                    x: bootstrap.bounds.min.x + 5.4,
                    y: bootstrap.playerSpawn.y,
                    z: bootstrap.bounds.max.z - 6.2,
                },
            };
            pickups[`${mapId}-pickup-tier-2`] = {
                id: `${mapId}-pickup-tier-2`,
                tier: 2,
                collected: false,
                position: {
                    x: bootstrap.bounds.max.x - 6.1,
                    y: bootstrap.playerSpawn.y,
                    z: bootstrap.bounds.min.z + 5.1,
                },
            };
        }
        const solidVolumes = bootstrap.brushes
            .map((brush) => ({
            minY: brush.min.y,
            maxY: brush.max.y,
            minX: brush.min.x,
            maxX: brush.max.x,
            minZ: brush.min.z,
            maxZ: brush.max.z,
        }));
        const room = {
            id: roomId,
            mapId,
            spawnPoint: { ...bootstrap.playerSpawn },
            bounds: { ...bootstrap.bounds },
            solidVolumes,
            enemySpawnPoints: [],
            safeSpawnPoints: [{ ...bootstrap.playerSpawn }],
            state: {
                roomId,
                mapId,
                players: {},
                enemies: {},
                pickups,
                startedAt: Date.now(),
            },
            clients: new Map(),
            enemyRespawnQueue: [],
            lastStateSyncAt: Date.now(),
            lastTickAt: Date.now(),
            serverTick: 0,
        };
        room.enemySpawnPoints = bootstrap.enemySpawns.map((spawn) => this.resolveOpenPosition(room, spawn, 0.62));
        room.safeSpawnPoints.push(...room.enemySpawnPoints.map((spawn) => ({ ...spawn })));
        const enemyKinds = ['zombie', 'blob', 'glub'];
        for (const [index, spawn] of room.enemySpawnPoints.entries()) {
            room.state.enemies[`${mapId}-enemy-${index}`] = {
                id: `${mapId}-enemy-${index}`,
                kind: enemyKinds[index % enemyKinds.length],
                position: { ...spawn },
                health: 6,
                maxHealth: 6,
                isDead: false,
            };
        }
        console.log(`[Multiplayer] Created room ${roomId} for map ${mapId}`);
        return room;
    }
    generatePlayerSpawn(room, playerIndex) {
        // Use known-safe spawn points (player spawn + enemy spawns) to avoid wall collisions
        // Cycle through these positions, offset slightly to distribute players
        if (room.safeSpawnPoints.length === 0) {
            return { ...room.spawnPoint };
        }
        const baseIndex = playerIndex % room.safeSpawnPoints.length;
        const baseSpawn = room.safeSpawnPoints[baseIndex];
        // Add a small radial offset based on how many times we've cycled through all spawns
        const cycle = Math.floor(playerIndex / room.safeSpawnPoints.length);
        const offsetAngle = (cycle * 1.8) % (Math.PI * 2);
        const offsetRadius = cycle * 1.2;
        return {
            x: baseSpawn.x + Math.cos(offsetAngle) * offsetRadius,
            y: baseSpawn.y,
            z: baseSpawn.z + Math.sin(offsetAngle) * offsetRadius,
        };
    }
    calculateSpawnYaw(position, bounds) {
        // Calculate yaw to face toward center of the map
        const centerX = (bounds.min.x + bounds.max.x) / 2;
        const centerZ = (bounds.min.z + bounds.max.z) / 2;
        const dx = centerX - position.x;
        const dz = centerZ - position.z;
        return Math.atan2(dx, dz);
    }
    chooseEnemyRespawnPosition(room, alivePlayers) {
        const candidates = room.enemySpawnPoints.length > 0 ? room.enemySpawnPoints : room.safeSpawnPoints;
        if (candidates.length === 0) {
            return { ...room.spawnPoint };
        }
        if (alivePlayers.length === 0) {
            const candidate = candidates[Math.floor(Math.random() * candidates.length)];
            return this.resolveOpenPosition(room, candidate, 0.62);
        }
        const minDesiredDistanceSq = 12 * 12;
        const farEnough = candidates.filter((candidate) => {
            for (const player of alivePlayers) {
                const dx = player.position.x - candidate.x;
                const dz = player.position.z - candidate.z;
                if (dx * dx + dz * dz < minDesiredDistanceSq) {
                    return false;
                }
            }
            return true;
        });
        const pool = farEnough.length > 0 ? farEnough : candidates;
        const candidate = pool[Math.floor(Math.random() * pool.length)];
        return this.resolveOpenPosition(room, candidate, 0.62);
    }
    resolveOpenPosition(room, desired, padding = 0.62) {
        const clampWithinBounds = (value, min, max) => Math.min(max - padding, Math.max(min + padding, value));
        const probeY = desired.y;
        const baseX = clampWithinBounds(desired.x, room.bounds.min.x, room.bounds.max.x);
        const baseZ = clampWithinBounds(desired.z, room.bounds.min.z, room.bounds.max.z);
        if (!this.isPositionBlocked(room, baseX, baseZ, padding, probeY)) {
            return { x: baseX, y: probeY, z: baseZ };
        }
        for (let ring = 1; ring <= 14; ring += 1) {
            const radius = ring * 0.6;
            for (let step = 0; step < 20; step += 1) {
                const angle = (step / 20) * Math.PI * 2;
                const candidateX = clampWithinBounds(baseX + Math.cos(angle) * radius, room.bounds.min.x, room.bounds.max.x);
                const candidateZ = clampWithinBounds(baseZ + Math.sin(angle) * radius, room.bounds.min.z, room.bounds.max.z);
                if (!this.isPositionBlocked(room, candidateX, candidateZ, padding, probeY)) {
                    return { x: candidateX, y: probeY, z: candidateZ };
                }
            }
        }
        return { x: baseX, y: probeY, z: baseZ };
    }
    isPositionBlocked(room, x, z, padding = 0.6, probeY = room.spawnPoint.y) {
        const minX = x - padding;
        const maxX = x + padding;
        const minZ = z - padding;
        const maxZ = z + padding;
        return room.solidVolumes.some((volume) => (probeY >= volume.minY
            && probeY <= volume.maxY
            && maxX > volume.minX
            && minX < volume.maxX
            && maxZ > volume.minZ
            && minZ < volume.maxZ));
    }
    tryMoveEnemy(room, enemy, target, deltaSeconds) {
        const dx = target.position.x - enemy.position.x;
        const dz = target.position.z - enemy.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= 0.001) {
            return;
        }
        const speed = 2.3;
        const stopDistance = 1.7;
        if (distance <= stopDistance) {
            return;
        }
        const step = Math.min(distance - stopDistance, speed * deltaSeconds);
        const baseDirX = dx / distance;
        const baseDirZ = dz / distance;
        const probeY = enemy.position.y;
        const turnAngles = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
        for (const angle of turnAngles) {
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const dirX = baseDirX * cos - baseDirZ * sin;
            const dirZ = baseDirX * sin + baseDirZ * cos;
            const nextX = enemy.position.x + dirX * step;
            const nextZ = enemy.position.z + dirZ * step;
            if (nextX <= room.bounds.min.x
                || nextX >= room.bounds.max.x
                || nextZ <= room.bounds.min.z
                || nextZ >= room.bounds.max.z) {
                continue;
            }
            if (!this.isPositionBlocked(room, nextX, nextZ, 0.62, probeY)) {
                enemy.position.x = nextX;
                enemy.position.z = nextZ;
                return;
            }
        }
    }
    send(ws, message) {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    buildVisiblePlayers(players) {
        const visiblePlayers = {};
        for (const [playerId, player] of Object.entries(players)) {
            if (!player.isDead && player.health > 0) {
                visiblePlayers[playerId] = player;
            }
        }
        return visiblePlayers;
    }
    buildVisibleRoomState(roomState) {
        return {
            ...roomState,
            players: this.buildVisiblePlayers(roomState.players),
        };
    }
    buildWorldDirectory() {
        return Array.from(this.rooms.values())
            .map((room) => ({
            roomId: room.id,
            mapId: room.mapId,
            players: room.clients.size,
            maxPlayers: MultiplayerManager.MAX_PLAYERS_PER_WORLD,
            startedAt: room.state.startedAt,
        }))
            .sort((left, right) => left.mapId.localeCompare(right.mapId) || left.startedAt - right.startedAt);
    }
    sendWorldDirectory(ws) {
        this.send(ws, {
            type: 'world-directory',
            payload: {
                worlds: this.buildWorldDirectory(),
            },
        });
    }
    broadcastWorldDirectory() {
        const worlds = this.buildWorldDirectory();
        for (const ws of this.directorySubscribers) {
            this.send(ws, {
                type: 'world-directory',
                payload: { worlds },
            });
        }
    }
    broadcast(room, message, excludeClientId) {
        for (const [clientId, client] of room.clients) {
            if (clientId !== excludeClientId) {
                this.send(client.ws, message);
            }
        }
    }
    getPreviewRoomForMap(mapId) {
        const roomsForMap = Array.from(this.rooms.values()).filter((room) => room.mapId === mapId && room.clients.size > 0);
        if (roomsForMap.length === 0) {
            return null;
        }
        roomsForMap.sort((left, right) => {
            if (right.clients.size !== left.clients.size) {
                return right.clients.size - left.clients.size;
            }
            return left.state.startedAt - right.state.startedAt;
        });
        return roomsForMap[0];
    }
    sendMapPreviewState(ws, mapId) {
        const room = this.getPreviewRoomForMap(mapId);
        this.send(ws, {
            type: 'map-preview-state',
            payload: {
                room: room ? this.buildVisibleRoomState(room.state) : null,
            },
        });
    }
    broadcastMapPreviewStates() {
        if (this.mapPreviewSubscriptions.size === 0) {
            return;
        }
        const roomByMap = new Map();
        for (const mapId of new Set(this.mapPreviewSubscriptions.values())) {
            const previewRoom = this.getPreviewRoomForMap(mapId);
            roomByMap.set(mapId, previewRoom ? this.buildVisibleRoomState(previewRoom.state) : null);
        }
        for (const [ws, mapId] of this.mapPreviewSubscriptions) {
            this.send(ws, {
                type: 'map-preview-state',
                payload: {
                    room: roomByMap.get(mapId) ?? null,
                },
            });
        }
    }
    // Process enemy respawns
    tick() {
        const now = Date.now();
        for (const room of this.rooms.values()) {
            const staleClients = Array.from(room.clients.values()).filter((client) => now - client.lastUpdate > MultiplayerManager.STALE_CLIENT_TIMEOUT_MS);
            for (const staleClient of staleClients) {
                this.evictClient(room, staleClient, 'stale-client-timeout');
            }
            for (const client of room.clients.values()) {
                if (now - client.lastPingAt >= MultiplayerManager.PING_INTERVAL_MS) {
                    client.lastPingAt = now;
                    this.send(client.ws, {
                        type: 'net-ping',
                        payload: { sentAt: now },
                    });
                }
            }
            const deltaSeconds = Math.min(Math.max((now - room.lastTickAt) / 1000, 0), 0.1);
            room.lastTickAt = now;
            const alivePlayers = Object.values(room.state.players).filter((player) => !player.isDead && player.health > 0);
            if (alivePlayers.length > 0) {
                for (const enemy of Object.values(room.state.enemies)) {
                    if (enemy.isDead) {
                        continue;
                    }
                    let nearest = alivePlayers[0];
                    let nearestDistanceSq = Number.POSITIVE_INFINITY;
                    for (const player of alivePlayers) {
                        const dx = player.position.x - enemy.position.x;
                        const dz = player.position.z - enemy.position.z;
                        const distanceSq = dx * dx + dz * dz;
                        if (distanceSq < nearestDistanceSq) {
                            nearestDistanceSq = distanceSq;
                            nearest = player;
                        }
                    }
                    const distance = Math.sqrt(nearestDistanceSq);
                    if (distance > 0.001) {
                        this.tryMoveEnemy(room, enemy, nearest, deltaSeconds);
                    }
                    if (distance < 2.0) {
                        if (nearest.invulnerable) {
                            continue;
                        }
                        const nextHealth = Math.max(0, nearest.health - 6.25 * deltaSeconds);
                        if (nextHealth !== nearest.health) {
                            nearest.health = nextHealth;
                            if (nearest.health <= 0) {
                                nearest.isDead = true;
                            }
                            this.broadcast(room, {
                                type: 'player-update',
                                payload: {
                                    playerId: nearest.id,
                                    state: {
                                        health: nearest.health,
                                        isDead: nearest.isDead,
                                    },
                                },
                            });
                        }
                    }
                }
            }
            const toRespawn = room.enemyRespawnQueue.filter((entry) => entry.spawnAt <= now);
            room.enemyRespawnQueue = room.enemyRespawnQueue.filter((entry) => entry.spawnAt > now);
            for (const { id } of toRespawn) {
                const enemy = room.state.enemies[id];
                if (enemy) {
                    const respawnPosition = this.chooseEnemyRespawnPosition(room, alivePlayers);
                    enemy.position = respawnPosition;
                    enemy.health = enemy.maxHealth;
                    enemy.isDead = false;
                    this.broadcast(room, {
                        type: 'enemy-spawn',
                        payload: { enemy },
                    });
                }
            }
            if (now - room.lastStateSyncAt >= 250) {
                room.lastStateSyncAt = now;
                room.serverTick += 1;
                const latestInputSeqByPlayer = {};
                const latencyByPlayer = {};
                for (const client of room.clients.values()) {
                    latestInputSeqByPlayer[client.playerId] = client.lastInputSeq;
                    latencyByPlayer[client.playerId] = {
                        rttMs: Math.round(client.rttMs),
                        jitterMs: Math.round(client.jitterMs),
                        outOfOrderInputs: client.outOfOrderInputs,
                        droppedInputGaps: client.droppedInputGaps,
                    };
                }
                this.broadcast(room, {
                    type: 'state-sync',
                    payload: {
                        room: this.buildVisibleRoomState(room.state),
                        serverTick: room.serverTick,
                        sentAt: now,
                        latestInputSeqByPlayer,
                        latencyByPlayer,
                    },
                });
            }
        }
        if (now - this.lastPreviewSyncAt >= MultiplayerManager.PREVIEW_SYNC_INTERVAL_MS) {
            this.lastPreviewSyncAt = now;
            this.broadcastMapPreviewStates();
        }
    }
}
