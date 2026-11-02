import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './database/barangay.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create a promise-based wrapper for sqlite3
class Database {
  constructor(db) {
    this.db = db;
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

const sqlite = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

export const db = new Database(sqlite);

export async function initDatabase() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      auth_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channel_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(channel_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

    -- Availability is orthogonal to users.status (auth lifecycle).
    -- A sick member keeps an ACTIVE account but is skipped by assignment.
    CREATE TABLE IF NOT EXISTS staff_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      is_available INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS complaint_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      citizen_id INTEGER NOT NULL,
      complaint_id TEXT NOT NULL UNIQUE,
      title TEXT,
      description TEXT NOT NULL,
      location TEXT,
      category_id INTEGER,
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      status TEXT NOT NULL DEFAULT 'SUBMITTED',
      channel_id INTEGER,
      assigned_to INTEGER,
      source TEXT NOT NULL DEFAULT 'online',
      submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolution TEXT,
      hearing_info TEXT,
      FOREIGN KEY (citizen_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES complaint_categories(id),
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS triage_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL UNIQUE,
      category_id INTEGER,
      suggested_priority TEXT,
      confidence REAL,
      language TEXT,
      model_type TEXT DEFAULT 'Naive Bayes',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (category_id) REFERENCES complaint_categories(id)
    );

    CREATE TABLE IF NOT EXISTS remarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_role TEXT NOT NULL,
      remark_text TEXT NOT NULL,
      action_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hearings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL,
      scheduled_date TEXT,
      scheduled_time TEXT,
      location TEXT,
      status TEXT DEFAULT 'SCHEDULED',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      target_record TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS service_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      feedback TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id)`).catch(() => {});

  await db.all(`PRAGMA table_info(users)`).then(async (columns) => {
    const hasAuthId = columns.some((col) => col.name === 'auth_id');
    if (!hasAuthId) {
      await db.exec(`ALTER TABLE users ADD COLUMN auth_id TEXT`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id)`);
    }
    if (!columns.some((col) => col.name === 'address')) {
      await db.exec(`ALTER TABLE users ADD COLUMN address TEXT`);
    }
  }).catch(() => {});

  await db.all(`PRAGMA table_info(complaints)`).then(async (columns) => {
    if (!columns.some((col) => col.name === 'location')) {
      await db.exec(`ALTER TABLE complaints ADD COLUMN location TEXT`);
    }
    if (!columns.some((col) => col.name === 'source')) {
      await db.exec(`ALTER TABLE complaints ADD COLUMN source TEXT NOT NULL DEFAULT 'online'`);
    }
  }).catch(() => {});

  await db.all(`PRAGMA table_info(triage_results)`).then(async (columns) => {
    if (!columns.some((col) => col.name === 'language')) {
      await db.exec(`ALTER TABLE triage_results ADD COLUMN language TEXT`);
    }
  }).catch(() => {});

  await db.all(`PRAGMA table_info(hearings)`).then(async (columns) => {
    if (!columns.some((col) => col.name === 'assigned_members')) {
      await db.exec(`ALTER TABLE hearings ADD COLUMN assigned_members TEXT`);
    }
    if (!columns.some((col) => col.name === 'result')) {
      await db.exec(`ALTER TABLE hearings ADD COLUMN result TEXT`);
    }
  }).catch(() => {});

  await seedDefaultData();
}

async function seedDefaultData() {
  const { default: bcrypt } = await import('bcryptjs');
  
  const defaultRoles = ['CITIZEN', 'TANOD', 'OFFICIAL', 'LUPON', 'ADMIN'];
  for (const roleName of defaultRoles) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO roles (name) VALUES (?)`,
        [roleName]
      );
    } catch (err) {
      console.error('Error seeding roles:', err);
    }
  }

  const defaultCategories = [
    'Safety Rules',
    'Damaged Infrastructures',
    'Medical Assistance',
    'Noise Complaints',
    'Drug Abuse',
    'Threats',
    'Cyberbullying',
    'Physical Assault',
    'Theft & Robbery',
    'Scams & Fraud',
    'Dispute/Conflict',
    'Animal Concerns',
  ];

  for (const categoryName of defaultCategories) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO complaint_categories (name) VALUES (?)`,
        [categoryName]
      );
    } catch (err) {
      console.error('Error seeding categories:', err);
    }
  }

  const defaultChannels = [
    {
      name: 'Safety Rules',
      description: 'Reports of barangay rule or ordinance violations, such as curfew violations, speeding, blocked emergency routes, unsafe fireworks, or prohibited activities.',
      previousDescription: 'Violations of barangay safety rules and ordinances',
    },
    {
      name: 'Damaged Infrastructures',
      description: 'Reports of damaged public roads, bridges, sidewalks, drainage, streetlights, water pipes, or other community facilities that may need repair.',
      previousDescription: 'Damaged roads, drainage, lights, public facilities',
    },
    {
      name: 'Medical Assistance',
      description: 'Requests for medical help, first aid, ambulance transport, or health-center support for illness, injury, or other urgent health concerns.',
      previousDescription: 'Medical / health emergency assistance requests',
    },
    {
      name: 'Noise Complaints',
      description: 'Reports of excessive or repeated noise that disturbs residents, including loud music, karaoke, construction, shouting, or late-night disturbances.',
      previousDescription: 'Noise disturbances and public nuisance',
    },
    {
      name: 'Drug Abuse',
      description: 'Reports of suspected illegal drug use, possession, selling, or distribution in the community. Include the location and relevant details if known.',
      previousDescription: 'Drug-related concerns and reports',
    },
    {
      name: 'Threats',
      description: 'Reports of threats, intimidation, or harassment toward a person or group, whether made in person, by phone, or through messages.',
      previousDescription: 'Threats, intimidation and harassment',
    },
    {
      name: 'Cyberbullying',
      description: 'Reports of online harassment or bullying, including abusive messages, humiliating posts, repeated insults, or harmful content shared on social media.',
      previousDescription: 'Online bullying, libel, threatening messages',
    },
    {
      name: 'Physical Assault',
      description: 'Reports of physical violence or attacks, such as hitting, punching, kicking, or fighting, including any injuries that may require medical attention.',
      previousDescription: 'Physical harm, fights and assault incidents',
    },
    {
      name: 'Theft & Robbery',
      description: 'Reports of stolen or taken property, including snatching, burglary, robbery, missing belongings, or thieves operating in the community.',
      previousDescription: 'Reports of stolen or taken property, including snatching, burglary, robbery, missing belongings, or thieves operating in the community.',
    },
    {
      name: 'Scams & Fraud',
      description: 'Reports of swindling or dishonesty for money or property, such as estafa, fake sellers, fake products, fake fees, or money schemes.',
      previousDescription: 'Reports of swindling or dishonesty for money or property, such as estafa, fake sellers, fake products, fake fees, or money schemes.',
    },
    {
      name: 'Dispute/Conflict',
      description: 'Reports of verbal quarrels, family or neighbor disputes, land, boundary, or money disagreements, and other conflicts that need mediation instead of violence.',
      previousDescription: 'Interpersonal or community disputes requiring mediation',
    },
    {
      name: 'Animal Concerns',
      description: 'Reports about stray, loose, or aggressive animals, such as dog bites or animals roaming the road, when urgent medical care is not the main request.',
      previousDescription: 'Reports about stray, loose, or aggressive animals, such as dog bites or animals roaming the road, when urgent medical care is not the main request.',
    },
  ];
  for (const channel of defaultChannels) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO channels (name, description) VALUES (?, ?)`,
        [channel.name, channel.description]
      );
      await db.run(
        `UPDATE channels SET description = ?
         WHERE name = ? AND (description IS NULL OR TRIM(description) = '' OR description = ?)`,
        [channel.description, channel.name, channel.previousDescription]
      );
    } catch (err) {
      console.error('Error seeding channels:', err);
    }
  }

  // ---- Category alignment for existing databases ----
  // Remaps complaints and triage results off the legacy category names onto the
  // approved set above, then drops legacy rows nothing references anymore.
  // Mirrors database/category_alignment_migration.sql (which covers Supabase).
  const legacyCategoryMap = {
    'Public Safety': 'Safety Rules',
    Infrastructure: 'Damaged Infrastructures',
    Health: 'Medical Assistance',
    Noise: 'Noise Complaints',
    Threat: 'Threats',
    'Bullying/Harassment': 'Threats',
    'Drug-related concern': 'Drug Abuse',
  };
  for (const [legacyName, alignedName] of Object.entries(legacyCategoryMap)) {
    try {
      const alignedCategory = await db.get(
        'SELECT id FROM complaint_categories WHERE name = ?',
        [alignedName]
      );
      const legacyCategory = await db.get(
        'SELECT id FROM complaint_categories WHERE name = ?',
        [legacyName]
      );
      if (alignedCategory && legacyCategory) {
        await db.run(
          'UPDATE complaints SET category_id = ? WHERE category_id = ?',
          [alignedCategory.id, legacyCategory.id]
        );
        await db.run(
          'UPDATE triage_results SET category_id = ? WHERE category_id = ?',
          [alignedCategory.id, legacyCategory.id]
        );
        await db.run(
          `DELETE FROM complaint_categories
           WHERE id = ?
             AND NOT EXISTS (SELECT 1 FROM complaints WHERE category_id = complaint_categories.id)
             AND NOT EXISTS (SELECT 1 FROM triage_results WHERE category_id = complaint_categories.id)`,
          [legacyCategory.id]
        );
      }

      // In this schema channels hold category names, so legacy ones move too.
      const alignedChannel = await db.get(
        'SELECT id FROM channels WHERE name = ?',
        [alignedName]
      );
      const legacyChannel = await db.get(
        'SELECT id FROM channels WHERE name = ?',
        [legacyName]
      );
      if (alignedChannel && legacyChannel) {
        await db.run(
          'UPDATE complaints SET channel_id = ? WHERE channel_id = ?',
          [alignedChannel.id, legacyChannel.id]
        );
        await db.run(
          `DELETE FROM channels
           WHERE id = ?
             AND NOT EXISTS (SELECT 1 FROM complaints WHERE channel_id = channels.id)
             AND NOT EXISTS (SELECT 1 FROM channel_members WHERE channel_id = channels.id)`,
          [legacyChannel.id]
        );
      }
    } catch (err) {
      console.error('Error aligning legacy category:', legacyName, err);
    }
  }

  // Static admin account (always guaranteed to exist)
  const adminRole = await db.get(`SELECT id FROM roles WHERE name = 'ADMIN'`);
  if (adminRole) {
    const adminExists = await db.get(`SELECT id FROM users WHERE email = 'admin@example.com'`);
    if (!adminExists) {
      const adminHash = await bcrypt.hash('password123', 10);
      await db.run(
        `INSERT INTO users (full_name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, 'ACTIVE')`,
        ['Admin User', 'admin@example.com', adminHash, adminRole.id]
      );
      console.log('Static admin account created: admin@example.com / password123');
    }
  }

  const demoUsers = [
    { fullName: 'Citizen User', email: 'citizen@example.com', password: 'password123', role: 'CITIZEN' },
    { fullName: 'Tanod User', email: 'tanod@example.com', password: 'password123', role: 'TANOD' },
    { fullName: 'Official User', email: 'official@example.com', password: 'password123', role: 'OFFICIAL' },
    { fullName: 'Lupon User', email: 'lupon@example.com', password: 'password123', role: 'LUPON' },
  ];

  for (const user of demoUsers) {
    try {
      const role = await db.get(`SELECT id FROM roles WHERE name = ?`, [user.role]);
      if (!role) continue;

      const existing = await db.get(`SELECT id FROM users WHERE email = ?`, [user.email]);
      if (!existing) {
        const passwordHash = await bcrypt.hash(user.password, 10);
        await db.run(
          `INSERT INTO users (full_name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, 'ACTIVE')`,
          [user.fullName, user.email, passwordHash, role.id]
        );
      }
    } catch (err) {
      console.error(`Error seeding user ${user.email}:`, err);
    }
  }
}
