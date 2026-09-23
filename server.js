const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3010;
const ROOT = __dirname;
const SHARED_DIR = path.join(ROOT, 'shared');

// Ensure shared directory exists
if (!fs.existsSync(SHARED_DIR)) {
    fs.mkdirSync(SHARED_DIR);
}

const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' https://webrd01.is.autonavi.com https://webrd02.is.autonavi.com https://webrd03.is.autonavi.com https://webrd04.is.autonavi.com https://map.geoq.cn",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
].join('; ');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB limit

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                reject(new Error('Body too large'));
                req.destroy();
                return;
            }
            body += chunk;
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    // === API: Proxy to POI extraction server (private/local only) ===
    if (pathname === '/api/poi' || pathname.startsWith('/api/poi/')) {
        const poiPath = pathname === '/api/poi' ? '/extract'
            : pathname === '/api/poi/health' ? '/health'
            : '/status/' + pathname.slice('/api/poi/'.length);
        try {
            const body = req.method === 'POST' ? await readBody(req) : null;
            const poiRes = await fetch(`http://127.0.0.1:3004${poiPath}`, {
                method: req.method,
                headers: { 'Content-Type': 'application/json' },
                ...(body ? { body } : {}),
            });
            const poiData = await poiRes.text();
            sendJson(res, poiRes.status, JSON.parse(poiData));
        } catch (err) {
            sendJson(res, 502, { error: 'POI server unavailable' });
        }
        return;
    }

    // === API: Resolve short URL (e.g. maps.app.goo.gl) ===
    if (req.method === 'GET' && pathname === '/api/resolve') {
        const target = new URL(req.url, `http://localhost`).searchParams.get('url');
        if (!target) { sendJson(res, 400, { error: 'Missing url parameter' }); return; }
        const targetHost = (() => { try { return new URL(target).hostname; } catch { return ''; } })();
        const ALLOWED_HOSTS = ['goo.gl', 'maps.app.goo.gl'];
        if (!ALLOWED_HOSTS.some(h => targetHost === h || targetHost.endsWith('.' + h))) {
            sendJson(res, 400, { error: 'Domain not allowed' });
            return;
        }
        try {
            const r = await fetch(target, {
                method: 'GET',
                redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
            });
            let finalUrl = r.url;

            // If HTTP redirect didn't escape the short URL, parse the body for an embedded Maps URL
            if (/goo\.gl|maps\.app\.goo\.gl/i.test(finalUrl)) {
                const body = await r.text();
                const match = body.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^"'\s\\<>]+/);
                if (match) finalUrl = match[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
            }

            console.log(`[resolve] ${target} → ${finalUrl}`);
            sendJson(res, 200, { url: finalUrl });
        } catch (err) {
            console.error(`[resolve] Failed: ${err.message}`);
            sendJson(res, 400, { error: 'Could not resolve URL' });
        }
        return;
    }

    // === API: Share a trip ===
    if (req.method === 'POST' && pathname === '/api/share') {
        try {
            const body = await readBody(req);
            const trip = JSON.parse(body);

            // Validate it looks like a trip object
            if (!trip.name || !trip.id) {
                sendJson(res, 400, { error: 'Invalid trip data' });
                return;
            }

            // Reuse existing shareId if the trip already has one, otherwise generate new
            let shareId = trip.shareId;
            if (shareId && /^[a-f0-9]+$/.test(shareId)) {
                // Validate the existing shareId format
            } else {
                shareId = crypto.randomBytes(8).toString('hex');
            }
            const filePath = path.join(SHARED_DIR, `${shareId}.json`);

            // Prevent traversal with reused IDs
            const normalized = path.normalize(filePath);
            if (!normalized.startsWith(SHARED_DIR)) {
                sendJson(res, 403, { error: 'Forbidden' });
                return;
            }

            // Save with metadata
            const shared = {
                trip,
                sharedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                shareId,
            };

            fs.writeFileSync(filePath, JSON.stringify(shared, null, 2));
            const isUpdate = trip.shareId === shareId;
            console.log(`${isUpdate ? 'Updated' : 'Shared'} trip "${trip.name}" as ${shareId}`);

            sendJson(res, 200, { shareId, url: `/?trip=${shareId}`, updatedAt: shared.updatedAt });
        } catch (err) {
            console.error('Share error:', err.message);
            sendJson(res, 400, { error: 'Failed to share trip' });
        }
        return;
    }

    // === API: Get a shared trip ===
    if (req.method === 'GET' && pathname.startsWith('/api/share/')) {
        const shareId = pathname.split('/')[3];

        // Validate shareId format (hex only)
        if (!shareId || !/^[a-f0-9]+$/.test(shareId)) {
            sendJson(res, 400, { error: 'Invalid share ID' });
            return;
        }

        const filePath = path.join(SHARED_DIR, `${shareId}.json`);
        const normalized = path.normalize(filePath);

        // Prevent traversal
        if (!normalized.startsWith(SHARED_DIR)) {
            sendJson(res, 403, { error: 'Forbidden' });
            return;
        }

        if (!fs.existsSync(normalized)) {
            sendJson(res, 404, { error: 'Shared trip not found' });
            return;
        }

        try {
            const data = JSON.parse(fs.readFileSync(normalized, 'utf8'));
            sendJson(res, 200, data);
        } catch {
            sendJson(res, 500, { error: 'Failed to read shared trip' });
        }
        return;
    }

    // === Static file serving ===
    let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    filePath = path.normalize(filePath);

    // Prevent directory traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Block access to shared directory via static serving
    if (filePath.startsWith(SHARED_DIR) && !pathname.startsWith('/api/')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache',
            'Content-Security-Policy': CSP,
        });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`EasyItinerary running at http://localhost:${PORT}`);
    console.log(`Network: http://${getLocalIP()}:${PORT}`);
    console.log('Press Ctrl+C to stop');
});

function getLocalIP() {
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return 'localhost';
}
