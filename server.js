// Static Next export server + tiny JSON API.
// Runtime data lives outside the static export so deployment can update UI code
// without wiping menu/admin edits.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'out');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MENU_FILE = path.join(DATA_DIR, 'menu.json');
const MENU_SEED_FILE = path.join(__dirname, 'data', 'menu-seed.json');
const ORDERS_DIR = path.join(DATA_DIR, 'orders');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PORT = process.env.PORT || 8081;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MENU_READ_SOURCE = String(process.env.MENU_READ_SOURCE || 'json').trim().toLowerCase();
const JSON_BODY_LIMIT = 2_000_000;
const IMAGE_UPLOAD_LIMIT = 12_000_000;
const MENU_READ_SOURCES = new Set(['json', 'database']);

if (!ADMIN_PASSWORD) {
  console.error('Missing ADMIN_PASSWORD. Set it before starting the menu server.');
  process.exit(1);
}

if (!MENU_READ_SOURCES.has(MENU_READ_SOURCE)) {
  console.error('MENU_READ_SOURCE must be either "json" or "database".');
  process.exit(1);
}

let databaseMenuReaderPromise;
let databaseMenuWriterPromise;

function loadDatabaseMenuReader() {
  if (!databaseMenuReaderPromise) {
    databaseMenuReaderPromise = import('./src/server/db/menu-read.ts');
  }

  return databaseMenuReaderPromise;
}

function loadDatabaseMenuWriter() {
  if (!databaseMenuWriterPromise) {
    databaseMenuWriterPromise = import('./src/server/db/menu-write.ts');
  }

  return databaseMenuWriterPromise;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const IMAGE_UPLOAD_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function cleanDishIds(ids) {
  const seen = new Set();
  return (Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((id) => {
      if (!Number.isFinite(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, maxBytes = JSON_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function extensionForUpload(contentType, filename) {
  if (IMAGE_UPLOAD_TYPES[contentType]) return IMAGE_UPLOAD_TYPES[contentType];
  const extension = path.extname(String(filename || '')).replace('.', '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
    return extension === 'jpeg' ? 'jpg' : extension;
  }
  return '';
}

function decodeImageUpload(body) {
  const contentType = String(body.contentType || '').toLowerCase();
  const extension = extensionForUpload(contentType, body.filename);
  if (!extension || !IMAGE_UPLOAD_TYPES[contentType]) {
    throw new Error('只支持 JPG、PNG、WEBP、GIF 图片');
  }

  const rawData = String(body.data || '');
  const base64 = rawData.includes(',') ? rawData.split(',').pop() : rawData;
  if (!base64 || !/^[a-zA-Z0-9+/=\s]+$/.test(base64)) {
    throw new Error('图片内容无效');
  }

  const buffer = Buffer.from(base64.replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw new Error('图片内容为空');
  if (buffer.length > IMAGE_UPLOAD_LIMIT) throw new Error('图片不能超过 12MB');

  return { buffer, extension };
}

function saveImageUpload(body) {
  const { buffer, extension } = decodeImageUpload(body);
  const dishId = Number(body.dishId);
  if (!Number.isFinite(dishId)) throw new Error('缺少菜品 ID');

  const menu = getMenu();
  const dish = menu.dishes.find((item) => item.id === dishId);
  if (!dish) throw new Error('菜品不存在');

  const filename = `${dishId}.${extension}`;
  const imagePath = path.join(UPLOADS_DIR, filename);
  const url = `/uploads/${filename}`;
  ensureDir(UPLOADS_DIR);
  fs.writeFileSync(imagePath, buffer);

  dish.image = url;
  dish.images = [url];
  saveMenu(menu);

  deleteUploadVariantsForDish(dishId, filename);

  return {
    url,
    filename,
    linked: true,
    size: buffer.length,
  };
}

function uploadPathFromUrl(value) {
  let pathname;
  try {
    pathname = new URL(String(value || ''), 'http://menu.local').pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith('/uploads/')) return null;
  const uploadPath = path.normalize(path.join(UPLOADS_DIR, pathname.replace(/^\/uploads\//, '')));
  const relativeUploadPath = path.relative(UPLOADS_DIR, uploadPath);
  if (relativeUploadPath.startsWith('..') || path.isAbsolute(relativeUploadPath)) return null;
  return uploadPath;
}

function uploadPathsForMenu(menu) {
  const paths = new Set();
  (menu.dishes || []).forEach((dish) => {
    [dish.image, ...(Array.isArray(dish.images) ? dish.images : [])].forEach((image) => {
      const uploadPath = uploadPathFromUrl(image);
      if (uploadPath) paths.add(uploadPath);
    });
  });
  return paths;
}

function deleteUploadPath(uploadPath) {
  try {
    fs.unlinkSync(uploadPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function deleteRemovedUploads(previousMenu, nextMenu) {
  const nextPaths = uploadPathsForMenu(nextMenu);
  uploadPathsForMenu(previousMenu).forEach((uploadPath) => {
    if (!nextPaths.has(uploadPath)) deleteUploadPath(uploadPath);
  });
}

function deleteUploadVariantsForDish(dishId, keepFilename) {
  ensureDir(UPLOADS_DIR);
  const prefix = `${Number(dishId)}.`;
  fs.readdirSync(UPLOADS_DIR).forEach((filename) => {
    if (filename !== keepFilename && filename.startsWith(prefix)) {
      deleteUploadPath(path.join(UPLOADS_DIR, filename));
    }
  });
}

function adminToken(req) {
  const bearer = req.headers.authorization || '';
  if (bearer.startsWith('Bearer ')) return bearer.slice('Bearer '.length);
  return req.headers['x-admin-password'] || '';
}

function requireAdmin(req, res) {
  if (adminToken(req) === ADMIN_PASSWORD) return true;
  sendJson(res, 401, { error: 'ADMIN_AUTH_REQUIRED' });
  return false;
}

function requireJsonImageUploadMode(res) {
  if (MENU_READ_SOURCE === 'json') return true;
  sendJson(res, 409, { error: 'DATABASE_MENU_WRITE_NOT_READY' });
  return false;
}

function sendDatabaseMenuWriteError(res, error) {
  const errorCode = error && typeof error.code === 'string' ? error.code : '';
  const knownErrors = {
    MENU_WRITE_VALIDATION_FAILED: 400,
    MENU_VERSION_CONFLICT: 409,
    DISH_ID_CONFLICT: 409,
    MENU_NOT_FOUND: 404,
  };
  const status = knownErrors[errorCode];

  if (status) {
    sendJson(res, status, { error: errorCode });
    return;
  }

  const safeLogCode = errorCode ? ` (${errorCode})` : '';
  console.error(`Database menu write failed${safeLogCode}.`);
  sendJson(res, 503, { error: 'DATABASE_MENU_UNAVAILABLE' });
}

function defaultMenu() {
  const seed = readJson(MENU_SEED_FILE, null);
  if (seed && Array.isArray(seed.dishes)) return seed;

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      title: '灶台菜单',
      subtitle: '今晚想吃什么，自己点',
      sections: [],
    },
    dishes: [],
  };
}

function normalizeMenu(menu) {
  const now = new Date().toISOString();
  const settings = menu && typeof menu.settings === 'object' ? menu.settings : {};
  const dishes = Array.isArray(menu?.dishes) ? menu.dishes : [];
  const sections = Array.isArray(settings.sections) ? settings.sections : [];

  return {
    version: Number(menu?.version) || 1,
    updatedAt: menu?.updatedAt || now,
    settings: {
      title: settings.title || '灶台菜单',
      subtitle: settings.subtitle || '今晚想吃什么，自己点',
      sections: sections
        .filter((section) => section && section.id && section.label)
        .map((section, index) => ({
          id: String(section.id),
          label: String(section.label),
          title: String(section.title || section.label),
          note: String(section.note || ''),
          category: section.category ? String(section.category) : null,
          recommendedOnly: Boolean(section.recommendedOnly),
          dishIds: Array.isArray(section.dishIds) ? cleanDishIds(section.dishIds) : null,
          sortOrder: Number(section.sortOrder) || index + 1,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    },
    dishes: dishes
      .filter((dish) => dish && Number.isFinite(Number(dish.id)) && dish.name)
      .map((dish, index) => {
        const dishId = Number(dish.id);
        const staticSlugImage = `/images/dishes/${dish.slug}.webp`;
        const staticIdImage = `/images/dishes/${dishId}.webp`;
        const rawImage = String(dish.image || staticIdImage);
        const image = rawImage === staticSlugImage ? staticIdImage : rawImage;
        const images = Array.isArray(dish.images) && dish.images.length ? dish.images.map(String) : [image];
        return {
          id: dishId,
          name: String(dish.name),
          slug: String(dish.slug || `dish-${dish.id}`),
          description: String(dish.description || ''),
          date: String(dish.date || '今晚菜单'),
          prepTime: String(dish.prepTime || '30分钟'),
          category: String(dish.category || '热菜'),
          accent: String(dish.accent || ''),
          difficulty: String(dish.difficulty || '简单'),
          recommended: Boolean(dish.recommended),
          servings: String(dish.servings || '2-3人份'),
          image,
          images: images.map((item) => (item === staticSlugImage ? staticIdImage : item)),
          ingredients: Array.isArray(dish.ingredients) ? dish.ingredients.map(String) : [],
          visible: dish.visible !== false,
          sortOrder: Number(dish.sortOrder) || index + 1,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
  };
}

function getMenu() {
  ensureDir(DATA_DIR);
  ensureDir(ORDERS_DIR);
  ensureDir(UPLOADS_DIR);
  if (!fs.existsSync(MENU_FILE)) {
    writeJson(MENU_FILE, normalizeMenu(defaultMenu()));
  }
  return normalizeMenu(readJson(MENU_FILE, defaultMenu()));
}

async function getDatabaseMenu() {
  const { readMenuFromDatabase } = await loadDatabaseMenuReader();
  return readMenuFromDatabase();
}

async function saveDatabaseMenu(menu) {
  const { writeMenuToDatabase } = await loadDatabaseMenuWriter();
  const result = await writeMenuToDatabase(menu);
  return result.menu;
}

function saveMenu(menu) {
  const previousMenu = fs.existsSync(MENU_FILE) ? normalizeMenu(readJson(MENU_FILE, defaultMenu())) : normalizeMenu(defaultMenu());
  const normalized = normalizeMenu({
    ...menu,
    updatedAt: new Date().toISOString(),
  });
  deleteRemovedUploads(previousMenu, normalized);
  writeJson(MENU_FILE, normalized);
  return normalized;
}

function cleanSessionId(value) {
  const id = String(value || 'today').trim();
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return id;
  return 'today';
}

function orderFile(sessionId) {
  return path.join(ORDERS_DIR, `${cleanSessionId(sessionId)}.json`);
}

function normalizeOrder(order, sessionId) {
  const seen = new Set();
  const items = Array.isArray(order?.items) ? order.items : [];

  return {
    sessionId: cleanSessionId(order?.sessionId || sessionId),
    updatedAt: order?.updatedAt || new Date().toISOString(),
    items: items
      .filter((item) => item && Number.isFinite(Number(item.id)))
      .map((item) => ({
        id: Number(item.id),
        quantity: Math.max(1, Number(item.quantity) || 1),
      }))
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
  };
}

function getOrder(sessionId) {
  ensureDir(ORDERS_DIR);
  return normalizeOrder(readJson(orderFile(sessionId), null), sessionId);
}

function saveOrder(sessionId, order) {
  const normalized = normalizeOrder({
    ...order,
    sessionId: cleanSessionId(sessionId),
    updatedAt: new Date().toISOString(),
  }, sessionId);
  writeJson(orderFile(sessionId), normalized);
  return normalized;
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Password',
    });
    res.end();
    return true;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/menu' && req.method === 'GET') {
    if (MENU_READ_SOURCE === 'json') {
      sendJson(res, 200, getMenu());
      return true;
    }

    try {
      const menu = await getDatabaseMenu();

      if (!menu) {
        sendJson(res, 404, { error: 'MENU_NOT_FOUND' });
        return true;
      }

      sendJson(res, 200, menu);
    } catch (error) {
      const errorCode = error && typeof error.code === 'string' ? ` (${error.code})` : '';
      console.error(`Database menu read failed${errorCode}.`);
      sendJson(res, 503, { error: 'DATABASE_MENU_UNAVAILABLE' });
    }
    return true;
  }

  if (pathname === '/api/menu' && req.method === 'PUT') {
    if (!requireAdmin(req, res)) return true;

    if (MENU_READ_SOURCE === 'json') {
      try {
        const body = await readBody(req);
        sendJson(res, 200, saveMenu(body));
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return true;
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, { error: 'INVALID_REQUEST_BODY' });
      return true;
    }

    try {
      sendJson(res, 200, await saveDatabaseMenu(body));
    } catch (error) {
      sendDatabaseMenuWriteError(res, error);
    }
    return true;
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return true;
    if (!requireJsonImageUploadMode(res)) return true;
    try {
      const body = await readBody(req, Math.ceil(IMAGE_UPLOAD_LIMIT * 1.5));
      sendJson(res, 200, saveImageUpload(body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const orderMatch = pathname.match(/^\/api\/order\/([^/]+)$/);
  if (orderMatch && req.method === 'GET') {
    sendJson(res, 200, getOrder(orderMatch[1]));
    return true;
  }

  if (orderMatch && req.method === 'PUT') {
    try {
      const body = await readBody(req);
      sendJson(res, 200, saveOrder(orderMatch[1], body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'NOT_FOUND' });
    return true;
  }

  return false;
}

function cacheControlFor(urlPath, extension) {
  if (urlPath.startsWith('/_next/static/')) return 'public, max-age=31536000, immutable';
  if (urlPath.startsWith('/images/')) return 'public, max-age=86400';
  if (urlPath.startsWith('/uploads/')) return 'no-cache';
  if (extension === '.woff' || extension === '.woff2') return 'public, max-age=86400';
  if (extension === '.html') return 'no-cache';
  return 'public, max-age=3600';
}

function send404(res) {
  fs.readFile(path.join(ROOT, '404.html'), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end('Not Found');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function serveFile(req, res, filePath, urlPath) {
  fs.stat(filePath, (err, stat) => {
    if (err || stat.isDirectory()) {
      send404(res);
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const lastModified = stat.mtime.toUTCString();
    const headers = {
      'Content-Type': TYPES[extension] || 'application/octet-stream',
      'Cache-Control': cacheControlFor(urlPath, extension),
      ETag: etag,
      'Last-Modified': lastModified,
    };

    const inm = req.headers['if-none-match'];
    const ims = req.headers['if-modified-since'];
    const notModified =
      (inm && inm === etag) ||
      (!inm && ims && new Date(ims).getTime() >= Math.floor(stat.mtimeMs / 1000) * 1000);
    if (notModified) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = decodeURIComponent(parsed.pathname);

  try {
    if (await handleApi(req, res, urlPath)) return;
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'SERVER_ERROR' });
    return;
  }

  if (urlPath.startsWith('/uploads/')) {
    const uploadPath = path.normalize(path.join(UPLOADS_DIR, urlPath.replace(/^\/uploads\//, '')));
    const relativeUploadPath = path.relative(UPLOADS_DIR, uploadPath);
    if (relativeUploadPath.startsWith('..') || path.isAbsolute(relativeUploadPath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    serveFile(req, res, uploadPath, urlPath);
    return;
  }

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      serveFile(req, res, path.join(filePath, 'index.html'), `${urlPath.replace(/\/$/, '')}/index.html`);
    } else if (!err) {
      serveFile(req, res, filePath, urlPath);
    } else {
      serveFile(req, res, `${filePath}.html`, `${urlPath}.html`);
    }
  });
});

server.listen(PORT, () => {
  ensureDir(DATA_DIR);
  ensureDir(ORDERS_DIR);
  ensureDir(UPLOADS_DIR);
  console.log(
    `menu server running on port ${PORT} (static=${ROOT}, data=${DATA_DIR}, menu=${MENU_READ_SOURCE})`,
  );
});
