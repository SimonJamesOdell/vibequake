// Quake BSP format constants
const BSP_VERSION = 29; // Quake 1 BSP version
const HEADER_SIZE = 4 + 15 * 8; // version + 15 lumps * (offset + size)
var LumpType;
(function (LumpType) {
    LumpType[LumpType["ENTITIES"] = 0] = "ENTITIES";
    LumpType[LumpType["PLANES"] = 1] = "PLANES";
    LumpType[LumpType["MIPTEX"] = 2] = "MIPTEX";
    LumpType[LumpType["VERTICES"] = 3] = "VERTICES";
    LumpType[LumpType["VISIBILITY"] = 4] = "VISIBILITY";
    LumpType[LumpType["NODES"] = 5] = "NODES";
    LumpType[LumpType["TEXINFO"] = 6] = "TEXINFO";
    LumpType[LumpType["FACES"] = 7] = "FACES";
    LumpType[LumpType["LIGHTING"] = 8] = "LIGHTING";
    LumpType[LumpType["CLIPNODES"] = 9] = "CLIPNODES";
    LumpType[LumpType["LEAVES"] = 10] = "LEAVES";
    LumpType[LumpType["MARKSURFACES"] = 11] = "MARKSURFACES";
    LumpType[LumpType["EDGES"] = 12] = "EDGES";
    LumpType[LumpType["SURFEDGES"] = 13] = "SURFEDGES";
    LumpType[LumpType["MODELS"] = 14] = "MODELS";
})(LumpType || (LumpType = {}));
export async function parseBSP(buffer) {
    const view = new DataView(buffer);
    // Read header
    const header = readHeader(view);
    if (header.version !== BSP_VERSION) {
        throw new Error(`Unsupported BSP version: ${header.version} (expected ${BSP_VERSION})`);
    }
    // Read lumps
    const entities = readEntities(view, header.lumps[LumpType.ENTITIES]);
    const vertices = readVertices(view, header.lumps[LumpType.VERTICES]);
    const edges = readEdges(view, header.lumps[LumpType.EDGES]);
    const surfEdges = readSurfEdges(view, header.lumps[LumpType.SURFEDGES]);
    const faces = readFaces(view, header.lumps[LumpType.FACES]);
    const models = readModels(view, header.lumps[LumpType.MODELS]);
    // World model (first model) contains the main geometry
    const worldModel = models[0];
    // Convert faces to brushes (approximate - each face becomes a thin brush)
    const brushes = [];
    for (let i = worldModel.firstFace; i < worldModel.firstFace + worldModel.numFaces; i++) {
        const face = faces[i];
        const points = [];
        // Build face polygon from edges
        for (let j = 0; j < face.numEdges; j++) {
            const surfEdgeIdx = face.firstEdge + j;
            const edgeIdx = surfEdges[surfEdgeIdx];
            const edge = edges[Math.abs(edgeIdx)];
            const vertexIdx = edgeIdx >= 0 ? edge[0] : edge[1];
            points.push(vertices[vertexIdx]);
        }
        // Skip degenerate faces
        if (points.length < 3) {
            continue;
        }
        // Each BSP face becomes a thin brush-like structure
        // Calculate bounds for the face
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const zs = points.map((p) => p.z);
        brushes.push({
            min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
            max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
            points,
            texture: 'metal', // BSP doesn't have simple texture names in the same way
        });
    }
    // Parse spawn points from entities
    const { playerSpawn, enemySpawns } = parseSpawnPoints(entities);
    // Calculate bounds
    const bounds = {
        min: worldModel.mins,
        max: worldModel.maxs,
    };
    return {
        id: 'bsp-map',
        name: 'Quake BSP Map',
        description: 'Imported from compiled Quake BSP file',
        format: 'brush-map',
        sourceFormat: 'quake-bsp',
        bounds,
        brushes,
        playerSpawn: playerSpawn || { x: 0, y: 2, z: 0 },
        enemySpawns: enemySpawns.length > 0 ? enemySpawns : [
            { x: 10, y: 2, z: 10 },
            { x: -10, y: 2, z: 10 },
            { x: 10, y: 2, z: -10 },
            { x: -10, y: 2, z: -10 },
        ],
        updatedAt: new Date().toISOString(),
    };
}
function readHeader(view) {
    const version = view.getInt32(0, true);
    const lumps = [];
    for (let i = 0; i < 15; i++) {
        const offset = view.getInt32(4 + i * 8, true);
        const size = view.getInt32(4 + i * 8 + 4, true);
        lumps.push({ offset, size });
    }
    return { version, lumps };
}
function readEntities(view, lump) {
    const bytes = new Uint8Array(view.buffer, lump.offset, lump.size);
    return new TextDecoder().decode(bytes);
}
function readVertices(view, lump) {
    const count = lump.size / 12; // 3 floats per vertex
    const vertices = [];
    for (let i = 0; i < count; i++) {
        const offset = lump.offset + i * 12;
        // Quake uses Z-up, we need Y-up, so swap Y and Z
        vertices.push({
            x: view.getFloat32(offset, true),
            y: view.getFloat32(offset + 8, true), // Z becomes Y
            z: view.getFloat32(offset + 4, true), // Y becomes Z
        });
    }
    return vertices;
}
function readEdges(view, lump) {
    const count = lump.size / 4; // 2 uint16s per edge
    const edges = [];
    for (let i = 0; i < count; i++) {
        const offset = lump.offset + i * 4;
        edges.push([
            view.getUint16(offset, true),
            view.getUint16(offset + 2, true),
        ]);
    }
    return edges;
}
function readSurfEdges(view, lump) {
    const count = lump.size / 4; // int32 per surfedge
    const surfEdges = [];
    for (let i = 0; i < count; i++) {
        surfEdges.push(view.getInt32(lump.offset + i * 4, true));
    }
    return surfEdges;
}
function readFaces(view, lump) {
    const count = lump.size / 20; // 20 bytes per face
    const faces = [];
    for (let i = 0; i < count; i++) {
        const offset = lump.offset + i * 20;
        faces.push({
            planeId: view.getUint16(offset, true),
            side: view.getUint16(offset + 2, true),
            firstEdge: view.getInt32(offset + 4, true),
            numEdges: view.getUint16(offset + 8, true),
            texInfo: view.getUint16(offset + 10, true),
        });
    }
    return faces;
}
function readModels(view, lump) {
    const count = lump.size / 64; // 64 bytes per model
    const models = [];
    for (let i = 0; i < count; i++) {
        const offset = lump.offset + i * 64;
        models.push({
            mins: {
                x: view.getFloat32(offset, true),
                y: view.getFloat32(offset + 8, true),
                z: view.getFloat32(offset + 4, true),
            },
            maxs: {
                x: view.getFloat32(offset + 12, true),
                y: view.getFloat32(offset + 20, true),
                z: view.getFloat32(offset + 16, true),
            },
            origin: {
                x: view.getFloat32(offset + 24, true),
                y: view.getFloat32(offset + 32, true),
                z: view.getFloat32(offset + 28, true),
            },
            headNodes: [
                view.getInt32(offset + 36, true),
                view.getInt32(offset + 40, true),
                view.getInt32(offset + 44, true),
                view.getInt32(offset + 48, true),
            ],
            numLeaves: view.getInt32(offset + 52, true),
            firstFace: view.getInt32(offset + 56, true),
            numFaces: view.getInt32(offset + 60, true),
        });
    }
    return models;
}
function parseSpawnPoints(entitiesText) {
    let playerSpawn = null;
    const enemySpawns = [];
    const entities = entitiesText.split('}');
    for (const entityText of entities) {
        if (!entityText.includes('{')) {
            continue;
        }
        const lines = entityText.split('\n');
        let classname = '';
        let origin = null;
        for (const line of lines) {
            const match = line.match(/"([^"]+)"\s+"([^"]*)"/);
            if (!match) {
                continue;
            }
            const [, key, value] = match;
            if (key === 'classname') {
                classname = value;
            }
            else if (key === 'origin') {
                const parts = value.split(' ').map(Number);
                if (parts.length === 3) {
                    // Swap Y and Z for coordinate system conversion
                    origin = { x: parts[0], y: parts[2], z: parts[1] };
                }
            }
        }
        if (origin) {
            if (classname === 'info_player_start' || classname === 'info_player_deathmatch') {
                playerSpawn = origin;
            }
            else if (classname.startsWith('monster_') || classname.startsWith('enemy_')) {
                enemySpawns.push(origin);
            }
        }
    }
    return { playerSpawn, enemySpawns };
}
