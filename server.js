try {
  require('dotenv').config();
} catch (e) {
  console.warn('[startup] dotenv no está instalado; usando variables del entorno del host');
}
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { execFileSync } = require('child_process');
const {
  upsertUser,
  getPublishedProducts,
  getFeaturedProducts,
  getCategories,
  getProductBySlug,
  getProductById,
  getProductsAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
  getDiscounts,
  getActiveDiscounts,
  createDiscount,
  deleteDiscount,
  calculateDiscount,
  createOrder,
  updateOrderById,
  updateOrderByPaypalId,
  getOrderByPaypalId,
  getOrdersByUser,
  getRecentOrders,
  getLicensesByUser,
  bindLicenseIp,
  getStats,
  fulfillOrder,
  getDownloadPathForLicense,
  validateLicense
} = require('./data');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const STORE_NAME = process.env.STORE_NAME || 'CS Store';
const STORE_TAGLINE = process.env.STORE_TAGLINE || 'Sistemas premium de MTA con licencias serias.';
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
const STORAGE_DIR = process.env.STORAGE_DIR?.trim() || path.join(__dirname, 'storage');
const uploadRoot = path.join(__dirname, 'public');
const uploadDir = path.join(STORAGE_DIR, 'uploads');
const downloadsDir = path.join(STORAGE_DIR, 'downloads');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(downloadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, file, cb) => cb(null, file.fieldname === 'product_file' ? downloadsDir : uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 80 * 1024 * 1024 } });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ verify: (req, _, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use('/downloads', express.static(downloadsDir));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 24 * 14 }
}));

function setFlash(req, type, text) {
  req.session.flash = { type, text };
}

function avatarUrl(user) {
  if (!user?.avatar) return 'https://cdn.discordapp.com/embed/avatars/0.png';
  return `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=256`;
}
function cartCount(cart) { return (cart || []).reduce((sum, item) => sum + item.quantity, 0); }
function cartSubtotal(cart) { return Number((cart || []).reduce((sum, item) => sum + item.quantity * item.price_usd, 0).toFixed(2)); }
function hydrateCart(cart) {
  return (cart || []).map(item => {
    const product = getProductById(item.product_id);
    return product ? { ...item, product } : null;
  }).filter(Boolean);
}
function requireAuth(req, res, next) { if (!req.session.user) return res.redirect('/auth/discord'); next(); }
function requireAdmin(req, res, next) { if (!req.session.user?.is_admin) return res.status(403).render('error', { title: 'Sin permiso', message: 'No tienes permiso para acceder a esta página.' }); next(); }

app.use((req, res, next) => {
  if (!req.session.cart) req.session.cart = [];
  res.locals.currentUser = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.storeName = STORE_NAME;
  res.locals.storeTagline = STORE_TAGLINE;
  res.locals.cartCount = cartCount(req.session.cart);
  res.locals.flash = req.session.flash || null;
  res.locals.activeDiscounts = getActiveDiscounts();
  delete req.session.flash;
  next();
});

function buildDiscordAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`,
    scope: 'identify email'
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    client_secret: process.env.DISCORD_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`
  });
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
async function fetchDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
async function getPayPalAccessToken() {
  const mode = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
  const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error(`PayPal token error: ${await response.text()}`);
  const data = await response.json();
  return { accessToken: data.access_token, base };
}
async function createPayPalOrder({ items, subtotal, discountAmount, total, orderId }) {
  const { accessToken, base } = await getPayPalAccessToken();
  const safeSubtotal = Number(Number(subtotal || 0).toFixed(2));
  const safeDiscount = Number(Number(discountAmount || 0).toFixed(2));
  const safeTotal = Number(Number(total || 0).toFixed(2));

  const breakdown = {
    item_total: {
      currency_code: 'USD',
      value: safeSubtotal.toFixed(2)
    }
  };
  if (safeDiscount > 0) {
    breakdown.discount = {
      currency_code: 'USD',
      value: safeDiscount.toFixed(2)
    };
  }

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: orderId,
      amount: { currency_code: 'USD', value: safeTotal.toFixed(2), breakdown },
      items: items.map(item => ({ name: String(item.name || 'Producto').slice(0, 127), quantity: String(Number(item.quantity || 1)), unit_amount: { currency_code: 'USD', value: Number(item.price_usd || 0).toFixed(2) } }))
    }],
    application_context: { brand_name: STORE_NAME, user_action: 'PAY_NOW', return_url: `${BASE_URL}/checkout/paypal/return`, cancel_url: `${BASE_URL}/cart` }
  };
  const response = await fetch(`${base}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`PayPal create order failed: ${await response.text()}`);
  return response.json();
}
async function capturePayPalOrder(paypalOrderId) {
  const { accessToken, base } = await getPayPalAccessToken();
  const response = await fetch(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  if (!response.ok) throw new Error(`PayPal capture failed: ${await response.text()}`);
  return response.json();
}
async function verifyPayPalWebhook(req) {
  const { accessToken, base } = await getPayPalAccessToken();
  const response = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: req.headers['paypal-auth-algo'], cert_url: req.headers['paypal-cert-url'], transmission_id: req.headers['paypal-transmission-id'], transmission_sig: req.headers['paypal-transmission-sig'], transmission_time: req.headers['paypal-transmission-time'], webhook_id: process.env.PAYPAL_WEBHOOK_ID, webhook_event: req.body
    })
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.verification_status === 'SUCCESS';
}
async function sendWebhook(eventName, fields) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(process.env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: STORE_NAME, embeds: [{ title: eventName, color: 5793266, fields, timestamp: new Date().toISOString() }] }) });
  } catch (error) { console.error('Discord webhook error:', error.message); }
}
function isValidServerIp(value) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}:(6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]?\d{1,4})$/.test(String(value || '').trim());
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function unzipTo(sourceAbs, destination) {
  if (process.platform === 'win32') {
    const tempZipCopy = path.join(os.tmpdir(), `zipcopy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
    fs.copyFileSync(sourceAbs, tempZipCopy);
    try {
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${tempZipCopy.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
      ], { stdio: 'pipe' });
    } finally {
      if (fs.existsSync(tempZipCopy)) fs.rmSync(tempZipCopy, { force: true });
    }
    return;
  }
  execFileSync('unzip', ['-qq', sourceAbs, '-d', destination]);
}

function zipFrom(sourceDir, outAbs) {
  if (process.platform === 'win32') {
    if (fs.existsSync(outAbs)) fs.rmSync(outAbs, { force: true });
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\*' -DestinationPath '${outAbs.replace(/'/g, "''")}' -Force`]);
    return;
  }
  execFileSync('zip', ['-qr', outAbs, '.'], { cwd: sourceDir });
}

function injectLicenseBlocksInFolder(folder) {
  const files = walk(folder);

  console.log('========== ARCHIVOS ENCONTRADOS EN ZIP ==========');
  files.forEach(file => console.log('-', path.relative(folder, file)));
  console.log('=================================================');

  const normalize = p => path.basename(p).trim().toLowerCase();
  const configPath = files.find(file => normalize(file) === 'cs_g.lua');
  const serverPath = files.find(file => normalize(file) === 'cs_s.lua');
  let injected = false;

  if (configPath) {
    fs.writeFileSync(configPath, 'ConfigLicense = {\n    license = ""\n}\n', 'utf8');
    injected = true;
    console.log('[LICENSE] Cs_G.lua detectado en:', configPath);
  } else {
    console.log('[LICENSE] Cs_G.lua NO encontrado');
  }

  if (serverPath) {
    const original = fs.readFileSync(serverPath, 'utf8');
    const block = `
-- >>> CS LICENSE BLOCK START >>>
local __CS_API__ = get('license.api') or 'http://127.0.0.1:3000/api/license/validate'

local function __csEncode(str)
    str = tostring(str or '')
    str = str:gsub('\n', '\r\n')
    str = str:gsub('([^%w%-_%.~])', function(c)
        return string.format('%%%02X', string.byte(c))
    end)
    return str
end

local function __csServerAddr()
    local ip = getServerConfigSetting('serverip') or ''
    local port = getServerConfigSetting('serverport') or ''
    return tostring(ip) .. ':' .. tostring(port)
end

local function __csStop()
    outputDebugString('[CS-LICENSE] Licencia invalida.', 1)
    stopResource(getThisResource())
end

local function __csStartProtectedSystem()
    outputDebugString('[CS-LICENSE] Licencia validada correctamente.', 3)
    if type(__cs_after_validation) == 'function' then
        __cs_after_validation()
    end
end

local function __csValidate()
    if not ConfigLicense or not ConfigLicense.license or ConfigLicense.license == '' then
        return __csStop()
    end

    local url = __CS_API__
        .. '?key=' .. __csEncode(ConfigLicense.license)
        .. '&ip=' .. __csEncode(__csServerAddr())

    fetchRemote(url, function(body, errno)
        if errno ~= 0 then
            return __csStop()
        end

        local data = fromJSON(body)
        if not data or not data.valid then
            return __csStop()
        end

        __csStartProtectedSystem()
    end)
end

__csValidate()
-- <<< CS LICENSE BLOCK END <<<
`.trim();

    if (!original.includes('-- >>> CS LICENSE BLOCK START >>>')) {
      let finalContent = original;
      if (finalContent.includes('-- [CS_LICENSE_INJECT_HERE]')) {
        finalContent = finalContent.replace('-- [CS_LICENSE_INJECT_HERE]', block);
      } else {
        finalContent = `${finalContent.trimEnd()}\n\n${block}\n`;
      }
      fs.writeFileSync(serverPath, finalContent, 'utf8');
      console.log('[LICENSE] Bloque inyectado en:', serverPath);
    } else {
      console.log('[LICENSE] Cs_S.lua ya tenía bloque de licencia:', serverPath);
    }

    injected = true;
  } else {
    console.log('[LICENSE] Cs_S.lua NO encontrado');
  }

  return { injected, foundConfig: !!configPath, foundServer: !!serverPath };
}

function processUploadedProductFile(filePath) {
  if (!filePath || path.extname(filePath).toLowerCase() !== '.zip') {
    return {
      publicPath: filePath ? `/downloads/${path.basename(filePath)}` : '',
      autoLicenseInjection: false,
      notes: []
    };
  }

  const sourceAbs = path.join(__dirname, 'public', filePath.replace(/^\//, ''));
  const unpack = tmpDir('mta-upload-');

  console.log('[UPLOAD] ZIP recibido:', sourceAbs);

  try {
    unzipTo(sourceAbs, unpack);
    console.log('[UPLOAD] ZIP extraído en:', unpack);

    const result = injectLicenseBlocksInFolder(unpack);

    const newName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-licensed.zip`;
    const outAbs = path.join(downloadsDir, newName);

    zipFrom(unpack, outAbs);
    console.log('[UPLOAD] ZIP final generado:', outAbs);

    return {
      publicPath: `/downloads/${newName}`,
      autoLicenseInjection: result.injected,
      notes: [
        result.foundConfig ? 'Cs_G.lua detectado.' : 'Cs_G.lua no encontrado.',
        result.foundServer ? 'Cs_S.lua detectado.' : 'Cs_S.lua no encontrado.',
        result.injected ? 'Bloques de licencia inyectados.' : 'No se inyectó licencia.'
      ]
    };
  } catch (error) {
    console.error('[UPLOAD ERROR]', error);
    return {
      publicPath: filePath ? `/downloads/${path.basename(filePath)}` : '',
      autoLicenseInjection: false,
      notes: [`No se pudo procesar el ZIP: ${error.message}`]
    };
  } finally {
    fs.rmSync(unpack, { recursive: true, force: true });
  }
}

function personalizeDownloadedZip(record) {
  const sourceAbs = path.join(__dirname, 'public', record.path.replace(/^\//, ''));
  if (path.extname(sourceAbs).toLowerCase() !== '.zip') {
    return { absolutePath: sourceAbs, filename: record.downloadName };
  }
  const unpack = tmpDir('mta-download-');
  const outAbs = path.join(tmpDir('mta-download-out-'), record.downloadName);
  unzipTo(sourceAbs, unpack);
  const configFile = walk(unpack).find(file => path.basename(file).toLowerCase() === 'cs_g.lua');
  if (configFile) {
    fs.writeFileSync(configFile, `ConfigLicense = {
    license = "${record.license.master_key || record.license.key}"
}
`);
  }
  zipFrom(unpack, outAbs);
  fs.rmSync(unpack, { recursive: true, force: true });
  return { absolutePath: outAbs, filename: record.downloadName, cleanupParent: path.dirname(outAbs) };
}

app.get('/', (req, res) => {
  res.render('index', { title: 'Inicio', products: getPublishedProducts(), featuredProducts: getFeaturedProducts(), categories: getCategories(), discordAuthUrl: buildDiscordAuthUrl() });
});
app.get('/catalog', (_, res) => res.redirect('/'));
app.get('/product/:slug', (req, res) => {
  const product = getProductBySlug(req.params.slug);
  if (!product) return res.status(404).render('error', { title: 'Producto no encontrado', message: 'Este producto no está disponible.' });
  res.render('product', { title: product.name, product, discordAuthUrl: buildDiscordAuthUrl() });
});
app.get('/cart', (req, res) => {
  const items = hydrateCart(req.session.cart);
  const subtotal = cartSubtotal(req.session.cart);
  const discountResult = calculateDiscount(subtotal, req.session.discountCode || '');
  res.render('cart', { title: 'Carrito', cartItems: items, subtotal, discountResult, appliedDiscountCode: req.session.discountCode || '', paypalConfigured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) });
});
app.post('/cart/add', (req, res) => {
  const product = getProductById(req.body.product_id);
  if (!product) return res.redirect('/');
  const quantity = Math.max(1, Number(req.body.quantity || 1));
  const existing = req.session.cart.find(item => item.product_id === product.id);
  if (existing) existing.quantity += quantity;
  else req.session.cart.push({ product_id: product.id, quantity, price_usd: Number(product.price_usd), name: product.name, slug: product.slug });
  setFlash(req, 'success', `${product.name} se agregó al carrito.`);
  res.redirect('/cart');
});
app.post('/cart/update', (req, res) => {
  const quantity = Math.max(1, Number(req.body.quantity || 1));
  const item = req.session.cart.find(entry => entry.product_id === req.body.product_id);
  if (item) item.quantity = quantity;
  setFlash(req, 'info', 'Cantidad actualizada.');
  res.redirect('/cart');
});
app.post('/cart/remove', (req, res) => {
  req.session.cart = req.session.cart.filter(entry => entry.product_id !== req.body.product_id);
  setFlash(req, 'warning', 'Producto retirado del carrito.');
  res.redirect('/cart');
});
app.post('/cart/apply-discount', (req, res) => {
  const subtotal = cartSubtotal(req.session.cart);
  const discountResult = calculateDiscount(subtotal, req.body.discount_code || '');
  if (discountResult.valid) {
    req.session.discountCode = discountResult.code;
    setFlash(req, 'success', discountResult.message);
  } else {
    req.session.discountCode = '';
    setFlash(req, 'error', discountResult.message || 'No se pudo aplicar el descuento.');
  }
  res.redirect('/cart');
});
app.post('/checkout/paypal/create', requireAuth, async (req, res) => {
  try {
    const items = hydrateCart(req.session.cart);
    if (!items.length) return res.redirect('/cart');
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      return res.status(500).render('error', { title: 'PayPal no configurado', message: 'Configura tus variables de PayPal antes de usar el checkout.' });
    }
    const subtotal = cartSubtotal(req.session.cart);
    const discountResult = calculateDiscount(subtotal, req.session.discountCode || '');
    const order = createOrder({
      user_id: req.session.user.id,
      customer_name: req.session.user.display_name || req.session.user.username,
      customer_email: req.session.user.email || '',
      customer_discord: req.session.user.username,
      subtotal_usd: subtotal,
      total_usd: discountResult.total,
      discount_code: discountResult.code,
      discount_type: discountResult.type,
      discount_value: discountResult.value,
      discount_amount_usd: discountResult.amount,
      notes: req.body.notes || '',
      items: items.map(item => ({ product_id: item.product.id, quantity: item.quantity, price_usd: Number(item.product.price_usd), name: item.product.name, slug: item.product.slug }))
    });
    const paypalOrder = await createPayPalOrder({ items: order.items, subtotal: order.subtotal_usd, discountAmount: order.discount_amount_usd, total: order.total_usd, orderId: order.id });
    updateOrderById(order.id, { paypal_order_id: paypalOrder.id, status: 'Esperando pago' });
    const approval = paypalOrder.links?.find(link => link.rel === 'approve')?.href;
    if (!approval) throw new Error('No se encontró la URL de aprobación de PayPal.');
    res.redirect(approval);
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Checkout fallido', message: error.message || 'No se pudo crear el pago con PayPal.' });
  }
});
app.get('/checkout/paypal/return', requireAuth, async (req, res) => {
  try {
    const paypalOrderId = String(req.query.token || '');
    if (!paypalOrderId) throw new Error('Falta el token de PayPal.');
    const existing = getOrderByPaypalId(paypalOrderId);
    if (!existing) throw new Error('Orden no encontrada.');
    if (existing.status !== 'Pagada') {
      const capture = await capturePayPalOrder(paypalOrderId);
      const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || '';
      updateOrderByPaypalId(paypalOrderId, { capture_id: captureId, status: 'Pagada', paid_at: new Date().toISOString() });
      fulfillOrder(existing.id);
      await sendWebhook('Nueva orden pagada', [
        { name: 'Orden', value: existing.order_number, inline: true },
        { name: 'Cliente', value: existing.customer_name, inline: true },
        { name: 'Total', value: `$${Number(existing.total_usd).toFixed(2)}`, inline: true }
      ]);
    }
    req.session.cart = [];
    req.session.discountCode = '';
    setFlash(req, 'success', 'Pago confirmado. Tus licencias ya están activas.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Pago no completado', message: error.message || 'No se pudo capturar el pago.' });
  }
});
app.post('/webhooks/paypal', async (req, res) => {
  try {
    if (!process.env.PAYPAL_WEBHOOK_ID) return res.status(204).end();
    const valid = await verifyPayPalWebhook(req);
    if (!valid) return res.status(400).send('Firma inválida');
    if (req.body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const paypalOrderId = req.body.resource?.supplementary_data?.related_ids?.order_id;
      const order = getOrderByPaypalId(paypalOrderId);
      if (order && order.status !== 'Pagada') {
        updateOrderByPaypalId(paypalOrderId, { status: 'Pagada', capture_id: req.body.resource?.id || '', paid_at: new Date().toISOString() });
        fulfillOrder(order.id);
      }
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('PayPal webhook error:', error.message);
    res.status(500).json({ ok: false });
  }
});
app.get('/dashboard', requireAuth, (req, res) => {
  const orders = getOrdersByUser(req.session.user.id);
  const licenses = getLicensesByUser(req.session.user.id).map(license => ({ ...license, product: getProductById(license.product_id) }));
  res.render('customer/dashboard', { title: 'Panel del cliente', orders, licenses, sharedKey: req.session.user.master_license_key || '', sharedIp: licenses[0]?.bound_ip || '' });
});
app.post('/licenses/:licenseId/ip', requireAuth, (req, res) => {
  const ip = String(req.body.ip || '').trim();
  if (!isValidServerIp(ip)) {
    return res.status(400).render('error', { title: 'IP inválida', message: 'Usa el formato IP:PUERTO, por ejemplo 151.243.93.145:22003.' });
  }
  const license = bindLicenseIp({ licenseId: req.params.licenseId, userId: req.session.user.id, ip });
  if (!license) return res.status(404).render('error', { title: 'Licencia no encontrada', message: 'Esta licencia no pertenece a tu cuenta.' });
  setFlash(req, 'success', 'IP del servidor guardada correctamente.');
  res.redirect('/dashboard');
});
app.get('/download/:licenseId', requireAuth, (req, res) => {
  const record = getDownloadPathForLicense(req.params.licenseId, req.session.user.id);

  if (!record) {
    return res.status(404).render('error', {
      title: 'Descarga no disponible',
      message: 'Este producto no tiene un archivo descargable adjunto todavía.'
    });
  }

  const built = personalizeDownloadedZip(record);

  res.download(built.absolutePath, built.filename, (err) => {
    if (err) {
      console.error('[DOWNLOAD ERROR]', err);
    }

    if (built.cleanupParent) {
      setTimeout(() => {
        try {
          if (fs.existsSync(built.cleanupParent)) {
            fs.rmSync(built.cleanupParent, { recursive: true, force: true });
            console.log('[DOWNLOAD] Carpeta temporal eliminada:', built.cleanupParent);
          }
        } catch (cleanupErr) {
          console.error('[DOWNLOAD CLEANUP ERROR]', cleanupErr.message);

          setTimeout(() => {
            try {
              if (fs.existsSync(built.cleanupParent)) {
                fs.rmSync(built.cleanupParent, { recursive: true, force: true });
                console.log('[DOWNLOAD] Carpeta temporal eliminada en segundo intento:', built.cleanupParent);
              }
            } catch (cleanupErr2) {
              console.error('[DOWNLOAD CLEANUP ERROR 2]', cleanupErr2.message);
            }
          }, 3000);
        }
      }, 1500);
    }
  });
});
app.get('/health', (_, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

app.get('/api/license/validate', (req, res) => {
  const result = validateLicense({ key: String(req.query.key || ''), ip: String(req.query.ip || '') });
  res.json(result);
});
app.get('/api/license/test', requireAuth, (req, res) => {
  const sample = getLicensesByUser(req.session.user.id)[0];
  const ip = req.query.ip || sample?.bound_ip || '127.0.0.1:22003';
  const product = req.query.product || (sample ? getProductById(sample.product_id)?.slug : 'staff-call-suite');
  const key = req.query.key || sample?.key || req.session.user.master_license_key || '';
  res.json({ base_url: BASE_URL, endpoint: `${BASE_URL}/api/license/validate`, example: `${BASE_URL}/api/license/validate?key=${encodeURIComponent(key)}&ip=${encodeURIComponent(ip)}` });
});
app.get('/auth/discord', (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    return res.status(500).render('error', { title: 'Discord no configurado', message: 'Configura las variables de OAuth de Discord antes de usar el login.' });
  }
  res.redirect(buildDiscordAuthUrl());
});
app.get('/auth/discord/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    const tokenData = await exchangeCode(String(req.query.code || ''));
    const profile = await fetchDiscordUser(tokenData.access_token);
    const user = upsertUser(profile, ADMIN_IDS.includes(profile.id));
    req.session.user = { id: user.id, discord_id: user.discord_id, username: user.username, display_name: user.global_name || user.username, email: user.email, avatar: user.avatar, avatar_url: avatarUrl(user), is_admin: !!user.is_admin, master_license_key: user.master_license_key || '' };
    res.redirect(req.session.user.is_admin ? '/admin' : '/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Autenticación fallida', message: error.message || 'No se pudo completar el login con Discord.' });
  }
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/dashboard', { title: 'Panel admin', stats: getStats(), products: getProductsAdmin(), orders: getRecentOrders(20), discounts: getDiscounts() });
});
app.get('/admin/products/new', requireAuth, requireAdmin, (req, res) => res.render('admin/product-form', { title: 'Nuevo producto', product: null }));
app.get('/admin/products/:id/edit', requireAuth, requireAdmin, (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) return res.status(404).render('error', { title: 'No encontrado', message: 'Producto no encontrado.' });
  res.render('admin/product-form', { title: 'Editar producto', product });
});
app.post('/admin/products', requireAuth, requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'product_file', maxCount: 1 }]), (req, res) => {
  const imageFile = req.files?.image?.[0];
  const productFile = req.files?.product_file?.[0];
  const processed = processUploadedProductFile(productFile ? `/downloads/${productFile.filename}` : '');
  createProduct({ ...req.body, featured: req.body.featured === 'on', published: req.body.published === 'on', image_path: imageFile ? `/uploads/${imageFile.filename}` : '', download_path: processed.publicPath, auto_license_injection: processed.autoLicenseInjection });
  setFlash(req, 'success', ['Producto creado correctamente.', ...processed.notes].filter(Boolean).join(' '));
  res.redirect('/admin');
});
app.post('/admin/products/:id', requireAuth, requireAdmin, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'product_file', maxCount: 1 }]), (req, res) => {
  const imageFile = req.files?.image?.[0];
  const productFile = req.files?.product_file?.[0];
  const processed = productFile ? processUploadedProductFile(`/downloads/${productFile.filename}`) : { publicPath: req.body.current_download_path || '', autoLicenseInjection: req.body.current_auto_license_injection === 'true', notes: [] };
  updateProduct(req.params.id, { ...req.body, featured: req.body.featured === 'on', published: req.body.published === 'on', image_path: imageFile ? `/uploads/${imageFile.filename}` : req.body.current_image_path || '', download_path: processed.publicPath, auto_license_injection: processed.autoLicenseInjection });
  setFlash(req, 'success', ['Producto actualizado.', ...processed.notes].filter(Boolean).join(' '));
  res.redirect('/admin');
});
app.post('/admin/products/:id/delete', requireAuth, requireAdmin, (req, res) => { deleteProduct(req.params.id); setFlash(req, 'warning', 'Producto eliminado.'); res.redirect('/admin'); });
app.post('/admin/discounts', requireAuth, requireAdmin, (req, res) => {
  createDiscount({ code: req.body.code, type: req.body.type, value: req.body.value, banner_text: req.body.banner_text, active: req.body.active === 'on' });
  setFlash(req, 'success', 'Código de descuento creado.');
  res.redirect('/admin');
});
app.post('/admin/discounts/:id/delete', requireAuth, requireAdmin, (req, res) => { deleteDiscount(req.params.id); setFlash(req, 'warning', 'Código eliminado.'); res.redirect('/admin'); });
app.use((_, res) => res.status(404).render('error', { title: 'Página no encontrada', message: 'Esta página no existe.' }));
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.listen(PORT, () => console.log(`Store running on ${BASE_URL}`));
