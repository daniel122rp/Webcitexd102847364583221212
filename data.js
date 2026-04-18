const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = process.env.STORAGE_DIR?.trim() || path.join(__dirname, 'storage');
const dbPath = path.join(STORAGE_DIR, 'data', 'store.json');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const starter = {
  users: [],
  products: [],
  orders: [],
  licenses: [],
  discounts: [
    {
      id: crypto.randomUUID(),
      code: 'BIENVENIDO10',
      type: 'percent',
      value: 10,
      active: true,
      banner_text: 'Usa BIENVENIDO10 y ahorra 10% en tu primera compra.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
};

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify(starter, null, 2));
}

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || `product-${Date.now()}`;
}

function generateMasterLicenseKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = 'CS-';
  const bytes = crypto.randomBytes(29);
  for (let i = 0; i < 29; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function normalizeDiscountCode(code) {
  return String(code || '').trim().toUpperCase();
}

function publicProduct(product) {
  return {
    ...product,
    image: product.image_path || product.image_url || '/placeholder.svg'
  };
}

function migrate() {
  const db = readDb();
  let changed = false;

  if (!Array.isArray(db.discounts)) {
    db.discounts = starter.discounts;
    changed = true;
  }

  for (const user of db.users || []) {
    if (typeof user.master_license_key === 'undefined') {
      user.master_license_key = generateMasterLicenseKey();
      changed = true;
    }
  }

  for (const product of db.products || []) {
    if (typeof product.auto_license_injection === 'undefined') {
      product.auto_license_injection = false;
      changed = true;
    }
  }

  for (const order of db.orders || []) {
    if (typeof order.discount_code === 'undefined') {
      order.discount_code = '';
      order.discount_type = '';
      order.discount_value = 0;
      order.discount_amount_usd = 0;
      order.total_usd = Number(order.subtotal_usd || 0);
      changed = true;
    }
  }

  for (const license of db.licenses || []) {
    if (typeof license.bound_ip === 'undefined') {
      license.bound_ip = '';
      changed = true;
    }
    if (typeof license.shared_key === 'undefined') {
      const owner = (db.users || []).find(u => u.id === license.user_id);
      license.shared_key = owner?.master_license_key || generateMasterLicenseKey();
      license.key = license.shared_key;
      changed = true;
    }
  }

  if (changed) writeDb(db);
}

function seed() {
  const db = readDb();
  if (db.products.length) return;
  db.products = [
    {
      id: id(),
      slug: 'staff-call-suite',
      name: 'Staff Call Suite',
      category: 'Administración',
      price_usd: 25,
      short_description: 'Sistema premium de llamados staff con paneles HTML y flujo limpio.',
      description: 'Paquete para servidores MTA con panel de llamados, cola de reportes, alertas y base preparada para servidores roleplay serios.',
      image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80',
      image_path: '',
      download_path: '',
      auto_license_injection: false,
      version: '2.1.0',
      featured: true,
      published: true,
      stock_status: 'Entrega instantánea',
      tags: ['staff','reportes','html'],
      created_at: now(),
      updated_at: now()
    },
    {
      id: id(),
      slug: 'neo-login-panel',
      name: 'Neo Login Panel',
      category: 'Autenticación',
      price_usd: 18,
      short_description: 'Login moderno con Discord linking y estética premium.',
      description: 'Panel de login con HTML, fondos animados, soporte para Discord y diseño limpio enfocado en una primera impresión fuerte.',
      image_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
      image_path: '',
      download_path: '',
      auto_license_injection: false,
      version: '1.9.3',
      featured: true,
      published: true,
      stock_status: 'Más vendido',
      tags: ['login','discord','ui'],
      created_at: now(),
      updated_at: now()
    },
    {
      id: id(),
      slug: 'orbit-inventory',
      name: 'Orbit Inventory',
      category: 'Gameplay',
      price_usd: 30,
      short_description: 'Inventario premium con drag & drop y filtros.',
      description: 'Inventario visual para MTA con ítems, categorías, detalles, stack support y una experiencia rápida para roleplay avanzado.',
      image_url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
      image_path: '',
      download_path: '',
      auto_license_injection: false,
      version: '3.0.1',
      featured: false,
      published: true,
      stock_status: 'Disponible',
      tags: ['inventory','roleplay','gameplay'],
      created_at: now(),
      updated_at: now()
    }
  ];
  writeDb(db);
}
seed();
migrate();

function upsertUser(profile, isAdmin) {
  const db = readDb();
  let user = db.users.find(u => u.discord_id === profile.id);
  const payload = {
    discord_id: profile.id,
    username: profile.username,
    global_name: profile.global_name || null,
    avatar: profile.avatar || null,
    email: profile.email || null,
    is_admin: !!isAdmin,
    updated_at: now()
  };

  if (user) {
    Object.assign(user, payload);
    if (!user.master_license_key) user.master_license_key = generateMasterLicenseKey();
  } else {
    user = { id: id(), created_at: now(), master_license_key: generateMasterLicenseKey(), ...payload };
    db.users.push(user);
  }
  writeDb(db);
  return user;
}

function getUserById(userId) {
  return readDb().users.find(u => u.id === userId);
}

function getPublishedProducts() {
  return readDb().products
    .filter(p => p.published)
    .map(publicProduct)
    .sort((a,b) => Number(b.featured) - Number(a.featured) || b.created_at.localeCompare(a.created_at));
}

function getFeaturedProducts(limit = 6) {
  return getPublishedProducts().filter(p => p.featured).slice(0, limit);
}

function getCategories() {
  return [...new Set(getPublishedProducts().map(p => p.category))].sort();
}

function getProductBySlug(slug) {
  const product = readDb().products.find(p => p.slug === slug && p.published);
  return product ? publicProduct(product) : null;
}

function getProductById(productId) {
  const product = readDb().products.find(p => p.id === productId);
  return product ? publicProduct(product) : null;
}

function getProductsAdmin() {
  return readDb().products.map(publicProduct).sort((a,b) => b.created_at.localeCompare(a.created_at));
}

function createProduct(data) {
  const db = readDb();
  const product = {
    id: id(),
    slug: data.slug?.trim() ? slugify(data.slug) : slugify(data.name),
    name: data.name,
    category: data.category,
    price_usd: Number(data.price_usd || 0),
    short_description: data.short_description,
    description: data.description,
    image_url: data.image_url || '',
    image_path: data.image_path || '',
    download_path: data.download_path || '',
    auto_license_injection: !!data.auto_license_injection,
    version: data.version || '1.0.0',
    stock_status: data.stock_status || 'Entrega instantánea',
    featured: !!data.featured,
    published: !!data.published,
    tags: Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(',').map(v => v.trim()).filter(Boolean),
    created_at: now(),
    updated_at: now()
  };
  db.products.push(product);
  writeDb(db);
  return publicProduct(product);
}

function updateProduct(productId, data) {
  const db = readDb();
  const product = db.products.find(p => p.id === productId);
  if (!product) return null;
  Object.assign(product, {
    slug: data.slug?.trim() ? slugify(data.slug) : product.slug,
    name: data.name,
    category: data.category,
    price_usd: Number(data.price_usd || 0),
    short_description: data.short_description,
    description: data.description,
    image_url: data.image_url || '',
    image_path: data.image_path || product.image_path || '',
    download_path: data.download_path || product.download_path || '',
    auto_license_injection: !!data.auto_license_injection,
    version: data.version || '1.0.0',
    stock_status: data.stock_status || 'Entrega instantánea',
    featured: !!data.featured,
    published: !!data.published,
    tags: Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(',').map(v => v.trim()).filter(Boolean),
    updated_at: now()
  });
  writeDb(db);
  return publicProduct(product);
}

function deleteProduct(productId) {
  const db = readDb();
  db.products = db.products.filter(p => p.id !== productId);
  writeDb(db);
}

function getDiscounts() {
  return readDb().discounts.slice().sort((a,b) => b.created_at.localeCompare(a.created_at));
}

function getActiveDiscounts() {
  return getDiscounts().filter(d => d.active);
}

function getDiscountByCode(code) {
  const normalized = normalizeDiscountCode(code);
  return readDb().discounts.find(d => normalizeDiscountCode(d.code) === normalized) || null;
}

function createDiscount(data) {
  const db = readDb();
  const discount = {
    id: id(),
    code: normalizeDiscountCode(data.code),
    type: data.type === 'fixed' ? 'fixed' : 'percent',
    value: Number(data.value || 0),
    active: !!data.active,
    banner_text: String(data.banner_text || '').trim(),
    created_at: now(),
    updated_at: now()
  };
  db.discounts.push(discount);
  writeDb(db);
  return discount;
}

function deleteDiscount(discountId) {
  const db = readDb();
  db.discounts = db.discounts.filter(d => d.id !== discountId);
  writeDb(db);
}

function calculateDiscount(subtotal, code) {
  const amount = Number(subtotal || 0);
  const discount = getDiscountByCode(code);
  if (!discount || !discount.active) {
    return {
      valid: false,
      code: '',
      type: '',
      value: 0,
      amount: 0,
      total: amount,
      message: code ? 'El código no es válido o ya no está activo.' : ''
    };
  }

  let discountAmount = 0;
  if (discount.type === 'percent') discountAmount = amount * (Number(discount.value || 0) / 100);
  else discountAmount = Number(discount.value || 0);

  discountAmount = Math.max(0, Math.min(amount, Number(discountAmount.toFixed(2))));
  const total = Number((amount - discountAmount).toFixed(2));

  return {
    valid: true,
    code: discount.code,
    type: discount.type,
    value: Number(discount.value || 0),
    amount: discountAmount,
    total,
    banner_text: discount.banner_text || '',
    message: discount.type === 'percent'
      ? `${discount.code} aplicado: ${discount.value}% de descuento.`
      : `${discount.code} aplicado: US$${Number(discount.value).toFixed(2)} de descuento.`
  };
}

function createOrder(data) {
  const db = readDb();
  const order = {
    id: id(),
    order_number: `ORD-${Date.now().toString().slice(-8)}`,
    user_id: data.user_id,
    paypal_order_id: data.paypal_order_id || '',
    status: data.status || 'Pendiente',
    subtotal_usd: Number(data.subtotal_usd || 0),
    discount_code: normalizeDiscountCode(data.discount_code || ''),
    discount_type: data.discount_type || '',
    discount_value: Number(data.discount_value || 0),
    discount_amount_usd: Number(data.discount_amount_usd || 0),
    total_usd: Number(data.total_usd || data.subtotal_usd || 0),
    customer_name: data.customer_name,
    customer_email: data.customer_email || '',
    customer_discord: data.customer_discord || '',
    notes: data.notes || '',
    items: data.items || [],
    created_at: now(),
    updated_at: now(),
    paid_at: null,
    capture_id: ''
  };
  db.orders.push(order);
  writeDb(db);
  return order;
}

function updateOrderById(orderId, patch) {
  const db = readDb();
  const order = db.orders.find(o => o.id === orderId);
  if (!order) return null;
  Object.assign(order, patch, { updated_at: now() });
  writeDb(db);
  return order;
}

function updateOrderByPaypalId(paypalOrderId, patch) {
  const db = readDb();
  const order = db.orders.find(o => o.paypal_order_id === paypalOrderId);
  if (!order) return null;
  Object.assign(order, patch, { updated_at: now() });
  writeDb(db);
  return order;
}

function getOrderById(orderId) {
  return readDb().orders.find(o => o.id === orderId);
}

function getOrderByPaypalId(paypalOrderId) {
  return readDb().orders.find(o => o.paypal_order_id === paypalOrderId);
}

function getOrdersByUser(userId) {
  return readDb().orders.filter(o => o.user_id === userId).sort((a,b) => b.created_at.localeCompare(a.created_at));
}

function getRecentOrders(limit = 30) {
  return readDb().orders.slice().sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

function getLicensesByUser(userId) {
  return readDb().licenses.filter(l => l.user_id === userId).sort((a,b) => b.created_at.localeCompare(a.created_at));
}

function bindLicenseIp({ licenseId, userId, ip }) {
  const db = readDb();
  const license = db.licenses.find(l => l.id === licenseId && l.user_id === userId);
  if (!license) return null;

  const userLicenses = db.licenses.filter(l => l.user_id === userId);
  for (const item of userLicenses) {
    item.bound_ip = ip;
    item.activations = (item.activations || 0) + 1;
    item.updated_at = now();
  }

  writeDb(db);
  return db.licenses.find(l => l.id === licenseId && l.user_id === userId) || null;
}

function getStats() {
  const db = readDb();
  return {
    totalProducts: db.products.length,
    liveProducts: db.products.filter(p => p.published).length,
    totalOrders: db.orders.length,
    paidOrders: db.orders.filter(o => o.status === 'Pagada').length,
    activeLicenses: db.licenses.filter(l => l.status === 'active').length,
    totalDiscounts: (db.discounts || []).length
  };
}

function fulfillOrder(orderId) {
  const db = readDb();
  const order = db.orders.find(o => o.id === orderId);
  if (!order) return null;

  const owner = db.users.find(u => u.id === order.user_id);
  const sharedKey = owner?.master_license_key || generateMasterLicenseKey();
  if (owner && !owner.master_license_key) owner.master_license_key = sharedKey;

  if (order.status !== 'Pagada') {
    order.status = 'Pagada';
    order.paid_at = now();
    order.updated_at = now();
  }

  for (const item of order.items || []) {
    const exists = db.licenses.find(l => l.user_id === order.user_id && l.product_id === item.product_id);
    if (!exists) {
      db.licenses.push({
        id: id(),
        key: sharedKey,
        shared_key: sharedKey,
        user_id: order.user_id,
        order_id: order.id,
        product_id: item.product_id,
        bound_ip: '',
        note: '',
        status: 'active',
        activations: 0,
        created_at: now(),
        updated_at: now()
      });
    }
  }
  writeDb(db);
  return order;
}

function getDownloadPathForLicense(licenseId, userId) {
  const db = readDb();
  const license = db.licenses.find(l => l.id === licenseId && l.user_id === userId);
  if (!license) return null;
  const product = db.products.find(p => p.id === license.product_id);
  const user = db.users.find(u => u.id === userId);
  if (!product?.download_path) return null;
  return {
    path: product.download_path,
    product,
    license: {
      ...license,
      master_key: user?.master_license_key || license.key
    },
    user,
    downloadName: `${slugify(product.name)}-licensed.zip`
  };
}

function validateLicense({ key, ip }) {
  const db = readDb();
  key = String(key || '').trim();
  ip = String(ip || '').trim();

  if (!key || !ip) return { valid: false, reason: 'missing_key_or_ip' };

  const user = db.users.find(u => String(u.master_license_key || '').trim() === key);
  if (!user) return { valid: false, reason: 'invalid_key' };

  const userLicenses = db.licenses.filter(l => l.user_id === user.id && l.status === 'active');
  if (!userLicenses.length) return { valid: false, reason: 'no_licenses' };

  const hasBoundIp = userLicenses.some(l => String(l.bound_ip || '').trim() === ip);
  if (!hasBoundIp) return { valid: false, reason: 'ip_mismatch' };

  return {
    valid: true,
    reason: 'ok',
    user: { id: user.id, discord_id: user.discord_id, username: user.username },
    license: { key: user.master_license_key, bound_ip: ip }
  };
}

module.exports = {
  slugify,
  upsertUser,
  getUserById,
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
  getDiscountByCode,
  createDiscount,
  deleteDiscount,
  calculateDiscount,
  createOrder,
  updateOrderById,
  updateOrderByPaypalId,
  getOrderById,
  getOrderByPaypalId,
  getOrdersByUser,
  getRecentOrders,
  getLicensesByUser,
  bindLicenseIp,
  getStats,
  fulfillOrder,
  getDownloadPathForLicense,
  validateLicense
};
