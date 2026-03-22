import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { legacyTilesToBrushMap } from '../src/shared/legacy-map.js';
import { parseBSP } from './quake-bsp.js';
import { parseQuakeMapSource } from './quake-map.js';
import { MultiplayerManager } from './multiplayer.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const mapsDir = path.join(dataDir, 'maps');
const highScoresPath = path.join(dataDir, 'highscores.json');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT ?? 3001);
const APPROVED_OPEN_LICENSES = new Set([
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    'MPL-2.0',
    'GPL-2.0-only',
    'GPL-2.0-or-later',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'LGPL-2.1-only',
    'LGPL-2.1-or-later',
    'LGPL-3.0-only',
    'LGPL-3.0-or-later',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'CC0-1.0',
    'CC-BY-4.0',
    'CC-BY-SA-4.0',
]);
const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));
const sanitizeId = (value) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const normalizeLicense = (value) => value.trim();
const assertApprovedOpenLicense = (value) => {
    const normalized = normalizeLicense(value);
    if (!APPROVED_OPEN_LICENSES.has(normalized)) {
        throw new Error(`Map license must be one of the approved open licenses: ${Array.from(APPROVED_OPEN_LICENSES).join(', ')}`);
    }
    return normalized;
};
const APPROVED_VISUAL_THEMES = new Set(['neon-tech', 'gothic-dungeon', 'industrial-rust']);
const normalizeVisualTheme = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    if (!APPROVED_VISUAL_THEMES.has(value)) {
        throw new Error(`Map visualTheme must be one of: ${Array.from(APPROVED_VISUAL_THEMES).join(', ')}`);
    }
    return value;
};
const isVec3 = (value) => Boolean(value)
    && typeof value === 'object'
    && typeof value.x === 'number'
    && typeof value.y === 'number'
    && typeof value.z === 'number';
const validateBrushMap = (value) => {
    if (!value || typeof value !== 'object') {
        throw new Error('Map payload must be an object.');
    }
    const candidate = value;
    if (!candidate.id || !candidate.name || !candidate.description) {
        throw new Error('Map payload requires id, name, and description.');
    }
    if (!candidate.bounds || !isVec3(candidate.bounds.min) || !isVec3(candidate.bounds.max)) {
        throw new Error('Brush maps require numeric min/max bounds.');
    }
    if (!Array.isArray(candidate.brushes) || candidate.brushes.length === 0) {
        throw new Error('Brush maps require at least one brush solid.');
    }
    if (!isVec3(candidate.playerSpawn)) {
        throw new Error('Brush maps require a numeric playerSpawn vector.');
    }
    if (!Array.isArray(candidate.enemySpawns) || candidate.enemySpawns.length === 0 || candidate.enemySpawns.some((spawn) => !isVec3(spawn))) {
        throw new Error('Brush maps require at least one numeric enemy spawn vector.');
    }
    return {
        id: sanitizeId(candidate.id),
        name: candidate.name.trim(),
        description: candidate.description.trim(),
        format: 'brush-map',
        sourceFormat: candidate.sourceFormat ?? 'brush-map',
        license: typeof candidate.license === 'string' ? assertApprovedOpenLicense(candidate.license) : undefined,
        sourceUrl: typeof candidate.sourceUrl === 'string' ? candidate.sourceUrl : undefined,
        attribution: typeof candidate.attribution === 'string' ? candidate.attribution.trim() : undefined,
        visualTheme: normalizeVisualTheme(candidate.visualTheme),
        bounds: candidate.bounds,
        brushes: candidate.brushes,
        playerSpawn: candidate.playerSpawn,
        enemySpawns: candidate.enemySpawns,
        updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    };
};
const normalizeMapPayload = (value, overrides) => {
    if (!value || typeof value !== 'object') {
        throw new Error('Map payload must be an object.');
    }
    const candidate = value;
    if (Array.isArray(candidate.tiles)) {
        const legacy = candidate;
        return legacyTilesToBrushMap({
            ...legacy,
            id: overrides?.id ?? legacy.id,
            name: overrides?.name ?? legacy.name,
            description: overrides?.description ?? legacy.description,
            license: overrides?.license ?? legacy.license,
            sourceUrl: overrides?.sourceUrl ?? legacy.sourceUrl,
            attribution: overrides?.attribution ?? legacy.attribution,
            updatedAt: overrides?.updatedAt ?? legacy.updatedAt,
        });
    }
    return validateBrushMap({
        ...candidate,
        ...overrides,
    });
};
const validateHighScoreSubmission = (value) => {
    if (!value || typeof value !== 'object') {
        throw new Error('High score submission must be an object.');
    }
    const candidate = value;
    const name = candidate.name?.trim().slice(0, 24);
    if (!name) {
        throw new Error('High score submission requires a player name.');
    }
    if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score) || candidate.score < 0) {
        throw new Error('High score submission requires a non-negative numeric score.');
    }
    if (!candidate.mapId || !sanitizeId(candidate.mapId)) {
        throw new Error('High score submission requires a valid mapId.');
    }
    return {
        name,
        score: Math.floor(candidate.score),
        mapId: sanitizeId(candidate.mapId),
    };
};
const validateMapImportRequest = (value) => {
    if (!value || typeof value !== 'object') {
        throw new Error('Map import request must be an object.');
    }
    const candidate = value;
    if (!candidate.url) {
        throw new Error('Map import request requires a url.');
    }
    if (!candidate.license) {
        throw new Error('Map import request requires an explicit open-source license.');
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(candidate.url);
    }
    catch {
        throw new Error('Map import url must be a valid absolute URL.');
    }
    if (parsedUrl.protocol !== 'https:') {
        throw new Error('Remote map import only allows https URLs.');
    }
    const id = candidate.id ? sanitizeId(candidate.id) : undefined;
    return {
        url: parsedUrl.toString(),
        id,
        license: assertApprovedOpenLicense(candidate.license),
        attribution: candidate.attribution?.trim(),
    };
};
const ensureStorage = async () => {
    await fs.mkdir(mapsDir, { recursive: true });
    try {
        await fs.access(highScoresPath);
    }
    catch {
        await fs.writeFile(highScoresPath, '[]\n', 'utf8');
    }
};
const readMap = async (id) => {
    const filePath = path.join(mapsDir, `${sanitizeId(id)}.json`);
    const contents = await fs.readFile(filePath, 'utf8');
    return normalizeMapPayload(JSON.parse(contents), { id: sanitizeId(id) });
};
const writeMap = async (map) => {
    const filePath = path.join(mapsDir, `${map.id}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
};
const importRemoteMap = async (request) => {
    const response = await fetch(request.url, {
        headers: {
            Accept: 'application/json, text/plain;q=0.9, text/x-quake-map;q=0.8, application/octet-stream;q=0.7',
        },
    });
    if (!response.ok) {
        throw new Error(`Remote map fetch failed with ${response.status}.`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const urlPath = new URL(request.url).pathname;
    const isJson = contentType.includes('application/json') || urlPath.endsWith('.json');
    const isBSP = urlPath.endsWith('.bsp');
    const timestamp = new Date().toISOString();
    let map;
    if (isJson) {
        const payload = await response.text();
        map = normalizeMapPayload(JSON.parse(payload), {
            id: request.id,
            license: request.license,
            sourceUrl: request.url,
            attribution: request.attribution,
            updatedAt: timestamp,
        });
    }
    else if (isBSP) {
        const payload = await response.arrayBuffer();
        const derivedId = request.id ?? sanitizeId(path.basename(urlPath, '.bsp') || 'imported-quake-bsp');
        const parsedMap = await parseBSP(payload);
        map = {
            ...parsedMap,
            id: derivedId,
            license: request.license,
            sourceUrl: request.url,
            attribution: request.attribution,
            updatedAt: timestamp,
        };
    }
    else {
        const payload = await response.text();
        const derivedId = request.id ?? sanitizeId(path.basename(urlPath, path.extname(urlPath)) || 'imported-quake-map');
        map = parseQuakeMapSource(payload, {
            id: derivedId,
            license: request.license,
            sourceUrl: request.url,
            attribution: request.attribution,
            updatedAt: timestamp,
        });
    }
    await writeMap(map);
    return map;
};
const listMapSummaries = async () => {
    const files = await fs.readdir(mapsDir);
    const summaries = await Promise.all(files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
        const map = await readMap(file.replace(/\.json$/u, ''));
        return {
            id: map.id,
            name: map.name,
            description: map.description,
            license: map.license,
            updatedAt: map.updatedAt,
        };
    }));
    return summaries.sort((left, right) => left.name.localeCompare(right.name));
};
const readHighScores = async () => {
    const contents = await fs.readFile(highScoresPath, 'utf8');
    const parsed = JSON.parse(contents);
    return parsed
        .filter((entry) => typeof entry?.score === 'number' && typeof entry?.name === 'string' && typeof entry?.mapId === 'string')
        .sort((left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt));
};
const writeHighScores = async (scores) => {
    await fs.writeFile(highScoresPath, `${JSON.stringify(scores, null, 2)}\n`, 'utf8');
};
app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
});
app.get('/api/maps', async (_request, response, next) => {
    try {
        response.json(await listMapSummaries());
    }
    catch (error) {
        next(error);
    }
});
app.get('/api/maps/:id', async (request, response, next) => {
    try {
        response.json(await readMap(request.params.id));
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/maps', async (request, response, next) => {
    try {
        const map = normalizeMapPayload(request.body, { updatedAt: new Date().toISOString() });
        await writeMap(map);
        response.status(201).json(map);
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/maps/import', async (request, response, next) => {
    try {
        const importRequest = validateMapImportRequest(request.body);
        const map = await importRemoteMap(importRequest);
        response.status(201).json(map);
    }
    catch (error) {
        next(error);
    }
});
app.put('/api/maps/:id', async (request, response, next) => {
    try {
        const map = normalizeMapPayload(request.body, { id: request.params.id, updatedAt: new Date().toISOString() });
        await writeMap(map);
        response.json(map);
    }
    catch (error) {
        next(error);
    }
});
app.get('/api/highscores', async (request, response, next) => {
    try {
        const limit = Math.min(Math.max(Number(request.query.limit ?? 10), 1), 25);
        const scores = await readHighScores();
        response.json(scores.slice(0, limit));
    }
    catch (error) {
        next(error);
    }
});
app.post('/api/highscores', async (request, response, next) => {
    try {
        const submission = validateHighScoreSubmission(request.body);
        const scores = await readHighScores();
        const nextEntry = {
            id: randomUUID(),
            name: submission.name,
            score: submission.score,
            mapId: submission.mapId,
            createdAt: new Date().toISOString(),
        };
        scores.push(nextEntry);
        scores.sort((left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt));
        await writeHighScores(scores.slice(0, 100));
        response.status(201).json(nextEntry);
    }
    catch (error) {
        next(error);
    }
});
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/u, async (_request, response, next) => {
        try {
            response.type('html').send(await fs.readFile(path.join(distDir, 'index.html'), 'utf8'));
        }
        catch (error) {
            next(error);
        }
    });
}
app.use((error, _request, response, _next) => {
    const status = error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 404 : 400;
    response.status(status).json({ error: error instanceof Error ? error.message : 'Unknown server error.' });
});
await ensureStorage();
// Create HTTP server and attach WebSocket server
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const multiplayerManager = new MultiplayerManager({
    resolveBootstrap: async (mapId) => {
        const map = await readMap(mapId);
        return {
            playerSpawn: map.playerSpawn,
            enemySpawns: map.enemySpawns,
            brushes: map.brushes,
            bounds: map.bounds,
        };
    },
});
// Handle WebSocket connections
wss.on('connection', (ws) => {
    multiplayerManager.handleConnection(ws);
});
// Start game tick for enemy respawns (60 Hz)
setInterval(() => {
    multiplayerManager.tick();
}, 1000 / 60);
httpServer.listen(port, () => {
    console.log(`VibeQuake API listening on http://localhost:${port}`);
    console.log(`VibeQuake Multiplayer WebSocket ready on ws://localhost:${port}`);
});
