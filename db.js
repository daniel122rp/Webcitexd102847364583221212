const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'store.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar TEXT,
  email TEXT,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_usd REAL NOT NULL,
  short_description TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  image_path TEXT,
  version TEXT DEFAULT '1.0.0',
  stock_status TEXT DEFAULT 'In stock',
  featured INTEGER DEFAULT 0,
  published INTEGER DEFAULT 1,
  downloads_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE NOT NULL,
  user_id INTEGER,
  product_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_discord TEXT,
  notes TEXT,
  status TEXT DEFAULT 'Pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

const now = () => new Date().toISOString();

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || `product-${Date.now()}`;
}

function upsertUser(profile, isAdmin) {
  const existing = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.id);
  const payload = {
    discord_id: profile.id,
    username: profile.username,
    global_name: profile.global_name || null,
    avatar: profile.avatar || null,
    email: profile.email || null,
    is_admin: isAdmin ? 1 : 0,
    updated_at: now()
  };

  if (existing) {
    db.prepare(`UPDATE users
      SET username=@username, global_name=@global_name, avatar=@avatar, email=@email, is_admin=@is_admin, updated_at=@updated_at
      WHERE discord_id=@discord_id`).run(payload);
    return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.id);
  }

  db.prepare(`INSERT INTO users (discord_id, username, global_name, avatar, email, is_admin, created_at, updated_at)
    VALUES (@discord_id, @username, @global_name, @avatar, @email, @is_admin, @updated_at, @updated_at)`).run(payload);
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(profile.id);
}

function getFeaturedProducts(limit = 6) {
  return db.prepare(`SELECT * FROM products WHERE published = 1 ORDER BY featured DESC, created_at DESC LIMIT ?`).all(limit);
}

function getAllPublishedProducts() {
  return db.prepare(`SELECT * FROM products WHERE published = 1 ORDER BY featured DESC, created_at DESC`).all();
}

function getProductBySlug(slug) {
  return db.prepare(`SELECT * FROM products WHERE slug = ? AND published = 1`).get(slug);
}

function getProductById(id) {
  return db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
}

function getAllProductsAdmin() {
  return db.prepare(`SELECT * FROM products ORDER BY created_at DESC`).all();
}

function createProduct(data) {
  const slug = data.slug?.trim() ? slugify(data.slug) : slugify(data.name);
  db.prepare(`INSERT INTO products
    (slug, name, category, price_usd, short_description, description, image_url, image_path, version, stock_status, featured, published, created_at, updated_at)
    VALUES (@slug, @name, @category, @price_usd, @short_description, @description, @image_url, @image_path, @version, @stock_status, @featured, @published, @created_at, @updated_at)`)
    .run({
      ...data,
      slug,
      created_at: now(),
      updated_at: now(),
      featured: data.featured ? 1 : 0,
      published: data.published ? 1 : 0
    });
}

function updateProduct(id, data) {
  const existing = getProductById(id);
  if (!existing) return;
  const slug = data.slug?.trim() ? slugify(data.slug) : existing.slug;
  db.prepare(`UPDATE products SET
      slug=@slug,
      name=@name,
      category=@category,
      price_usd=@price_usd,
      short_description=@short_description,
      description=@description,
      image_url=@image_url,
      image_path=@image_path,
      version=@version,
      stock_status=@stock_status,
      featured=@featured,
      published=@published,
      updated_at=@updated_at
    WHERE id=@id`).run({
      ...data,
      id,
      slug,
      updated_at: now(),
      featured: data.featured ? 1 : 0,
      published: data.published ? 1 : 0
    });
}

function deleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

function createOrder(data) {
  const order_number = `ORD-${Date.now().toString().slice(-8)}`;
  db.prepare(`INSERT INTO orders
    (order_number, user_id, product_id, customer_name, customer_email, customer_discord, notes, status, created_at)
    VALUES (@order_number, @user_id, @product_id, @customer_name, @customer_email, @customer_discord, @notes, @status, @created_at)`)
    .run({
      ...data,
      order_number,
      status: data.status || 'Pending',
      created_at: now()
    });
  return db.prepare('SELECT * FROM orders WHERE order_number = ?').get(order_number);
}

function getRecentOrders(limit = 20) {
  return db.prepare(`
    SELECT o.*, p.name AS product_name
    FROM orders o
    JOIN products p ON p.id = o.product_id
    ORDER BY o.created_at DESC
    LIMIT ?
  `).all(limit);
}

function getStats() {
  return {
    totalProducts: db.prepare('SELECT COUNT(*) AS total FROM products').get().total,
    liveProducts: db.prepare('SELECT COUNT(*) AS total FROM products WHERE published = 1').get().total,
    featuredProducts: db.prepare('SELECT COUNT(*) AS total FROM products WHERE featured = 1').get().total,
    totalOrders: db.prepare('SELECT COUNT(*) AS total FROM orders').get().total
  };
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS total FROM products').get().total;
  if (count > 0) return;

  const starterProducts = [
    {
      name: 'Staff Core Suite',
      category: 'Administration',
      price_usd: 24.99,
      short_description: 'Advanced staff call, reports and live moderation panel.',
      description: 'A premium moderation package for serious communities. Includes live tickets, staff call center, quick actions, player lookups, punish logs and polished interfaces built for MTA roleplay and freeroam servers.',
      image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80',
      image_path: null,
      version: '2.4.1',
      stock_status: 'Instant delivery',
      featured: 1,
      published: 1,
      slug: 'staff-core-suite'
    },
    {
      name: 'Neo Login Experience',
      category: 'Authentication',
      price_usd: 14.99,
      short_description: 'Cinematic login and account panel with Discord linking.',
      description: 'Modern login experience with animated landing states, secure account sessions, background visuals, feature callouts and Discord account connection support.',
      image_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
      image_path: null,
      version: '1.7.3',
      stock_status: 'In stock',
      featured: 1,
      published: 1,
      slug: 'neo-login-experience'
    },
    {
      name: 'Orbit Inventory',
      category: 'Gameplay',
      price_usd: 29.99,
      short_description: 'Responsive inventory with drag & drop and category filters.',
      description: 'Beautiful inventory system with slots, item detail views, rarity styling, stack support and fast-loading frontend components for immersive roleplay gameplay.',
      image_url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
      image_path: null,
      version: '3.0.0',
      stock_status: 'Best seller',
      featured: 0,
      published: 1,
      slug: 'orbit-inventory'
    }
  ];

  starterProducts.forEach(createProduct);
}

seed();

module.exports = {
  db,
  upsertUser,
  getFeaturedProducts,
  getAllPublishedProducts,
  getProductBySlug,
  getProductById,
  getAllProductsAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
  createOrder,
  getRecentOrders,
  getStats,
  slugify
};
