const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "db.json");
const sessions = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const defaultDb = {
  users: [
    { id: "user-admin", name: "Coordinador", username: "admin", password: "admin123", role: "admin", technicianId: null },
    { id: "user-carlos", name: "Carlos Ruiz", username: "carlos", password: "1234", role: "tech", technicianId: "tech-1" },
    { id: "user-laura", name: "Laura Gomez", username: "laura", password: "1234", role: "tech", technicianId: "tech-2" },
    { id: "user-miguel", name: "Miguel Torres", username: "miguel", password: "1234", role: "tech", technicianId: "tech-3" },
  ],
  technicians: [
    { id: "tech-1", name: "Carlos Ruiz", userId: "user-carlos", phone: "" },
    { id: "tech-2", name: "Laura Gomez", userId: "user-laura", phone: "" },
    { id: "tech-3", name: "Miguel Torres", userId: "user-miguel", phone: "" },
  ],
  orders: [],
  activities: [],
  notificationLog: [],
};

function uid(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;

  if (!storedPassword.startsWith("pbkdf2_sha256$")) {
    return storedPassword === password;
  }

  const [, iterations, salt, hash] = storedPassword.split("$");

  const candidate = crypto.pbkdf2Sync(
    String(password),
    salt,
    Number(iterations),
    32,
    "sha256",
  );

  const stored = Buffer.from(hash, "hex");

  return stored.length === candidate.length &&
    crypto.timingSafeEqual(stored, candidate);
}

function passwordNeedsMigration(storedPassword) {
  return Boolean(
    storedPassword &&
    !storedPassword.startsWith("pbkdf2_sha256$"),
  );
}

async function readDb() {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, "utf-8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    await writeDb(defaultDb);

    return structuredClone(defaultDb);
  }
}

async function writeDb(db) {
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

function sanitizeUser(user) {
  const { password, ...safeUser } = user;
  return safeUser;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });

  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
  });

  res.end(html);
}

async function readBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;

    if (body.length > 15_000_000) {
      throw new Error("La solicitud es demasiado grande.");
    }
  }

  return body ? JSON.parse(body) : {};
}

function getBearerToken(req, url) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    return header.slice(7);
  }

  return url.searchParams.get("token");
}

function requireSession(req, url) {
  const token = getBearerToken(req, url);
  const user = token ? sessions.get(token) : null;

  if (!user) {
    const error = new Error("No autorizado.");
    error.status = 401;
    throw error;
  }

  return { token, user };
}

function requireAdmin(user) {
  if (user.role !== "admin") {
    const error = new Error("Solo el coordinador puede realizar esta accion.");
    error.status = 403;
    throw error;
  }
}

function addActivity(db, text, orderId = null) {
  db.activities.unshift({
    id: uid("activity"),
    text,
    orderId,
    createdAt: new Date().toISOString(),
  });

  db.activities = db.activities.slice(0, 50);
}

function publicBootstrap(db, user) {
  const technicians = db.technicians.map((technician) => {
    const techUser = db.users.find(
      (item) => item.id === technician.userId,
    );

    return {
      ...technician,
      username: techUser?.username || "",
    };
  });

  return {
    user: sanitizeUser(user),

    technicians:
      user.role === "admin"
        ? technicians
        : technicians.filter(
            (technician) =>
              technician.id === user.technicianId,
          ),

    orders:
      user.role === "admin"
        ? db.orders
        : db.orders.filter(
            (order) =>
              order.assignedTo === user.technicianId,
          ),

    activities: db.activities,
  };
}

function getTechnician(db, technicianId) {
  return db.technicians.find(
    (technician) => technician.id === technicianId,
  );
}

async function notify(db, type, order) {
  const technician = getTechnician(db, order.assignedTo);

  const message =
    `${order.code}: ${order.asset} en ${order.location}. Estado: ${order.status}.`;

  const logEntry = {
    id: uid("notification"),
    type,
    orderId: order.id,
    technicianId: order.assignedTo,
    message,
    createdAt: new Date().toISOString(),
    channels: [],
  };

  if (!logEntry.channels.length) {
    logEntry.channels.push({
      channel: "console",
      ok: true,
      status: "configured-later",
    });

    console.log(`[notificacion:${type}] ${message}`);
  }

  db.notificationLog.unshift(logEntry);
}

function nextOrderCode(db) {
  const next = db.orders.length + 1;
  return `OM-${String(next).padStart(4, "0")}`;
}

function reportHtml(db, order) {
  const technician = getTechnician(db, order.assignedTo);

  const evidence = order.evidence
    .map((item) => `<img alt="Evidencia" src="${item.dataUrl}" />`)
    .join("");

  const intervention =
    order.interventionDescription ||
    "Sin descripcion de intervencion registrada.";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Reporte ${order.code}</title>
</head>
<body>
<h1>Reporte ${escapeHtml(order.code)}</h1>
<p>${escapeHtml(intervention)}</p>
${evidence}
</body>
</html>`;
}

async function handleApi(req, res, url) {
  const db = await readDb();

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);

    const user = db.users.find(
      (item) =>
        item.username === body.username &&
        verifyPassword(body.password, item.password),
    );

    if (!user) {
      return sendJson(res, 401, {
        error: "Usuario o contrasena incorrectos.",
      });
    }

    if (passwordNeedsMigration(user.password)) {
      user.password = hashPassword(body.password);
      await writeDb(db);
    }

    const token = crypto.randomBytes(24).toString("hex");

    sessions.set(token, sanitizeUser(user));

    return sendJson(res, 200, {
      token,
      user: sanitizeUser(user),
    });
  }

  const { user } = requireSession(req, url);

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return sendJson(res, 200, publicBootstrap(db, user));
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    requireAdmin(user);

    const body = await readBody(req);

    const order = {
      id: uid("order"),
      code: nextOrderCode(db),
      asset: body.asset,
      location: body.location,
      priority: body.priority || "Media",
      assignedTo: body.assignedTo || "",
      description: body.description,
      status: body.assignedTo ? "assigned" : "pending",
      interventionDescription: "",
      evidence: [],
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };

    db.orders.push(order);

    addActivity(
      db,
      `${order.code} creada y ${
        order.assignedTo
          ? "enviada al tecnico asignado"
          : "dejada pendiente"
      }.`,
      order.id,
    );

    await notify(db, "order-created", order);

    await writeDb(db);

    return sendJson(res, 201, { order });
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);

  if (req.method === "PUT" && orderMatch) {
    requireAdmin(user);

    const body = await readBody(req);

    const order = db.orders.find(
      (item) => item.id === orderMatch[1],
    );

    if (!order) {
      return sendJson(res, 404, {
        error: "Orden no encontrada.",
      });
    }

    const assignedTo = String(body.assignedTo || "").trim();

    order.asset = String(body.asset || "").trim();
    order.location = String(body.location || "").trim();
    order.priority = String(body.priority || "Media").trim();
    order.assignedTo = assignedTo;
    order.status = body.status || order.status;
    order.description = String(body.description || "").trim();
    order.interventionDescription = String(
      body.interventionDescription || "",
    ).trim();

    if (order.status === "done") {
      order.finishedAt =
        order.finishedAt || new Date().toISOString();
    } else {
      order.finishedAt = null;
    }

    addActivity(
      db,
      `${order.code} fue editada por el coordinador.`,
      order.id,
    );

    await notify(db, "order-updated", order);

    await writeDb(db);

    return sendJson(res, 200, { order });
  }

  // ELIMINAR ORDEN
  if (req.method === "DELETE" && orderMatch) {
    requireAdmin(user);

    const order = db.orders.find(
      (item) => item.id === orderMatch[1],
    );

    if (!order) {
      return sendJson(res, 404, {
        error: "Orden no encontrada.",
      });
    }

    db.orders = db.orders.filter(
      (item) => item.id !== order.id,
    );

    addActivity(
      db,
      `${order.code} fue eliminada por el coordinador.`,
      order.id,
    );

    await writeDb(db);

    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, {
    error: "Ruta no encontrada.",
  });
}

async function serveStatic(req, res, url) {
  let filePath =
    url.pathname === "/"
      ? "/index.html"
      : decodeURIComponent(url.pathname);

  filePath = path
    .normalize(filePath)
    .replace(/^(\.\.[/\\])+/, "");

  const absolutePath = path.join(ROOT, filePath);

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const file = await fs.readFile(absolutePath);

    res.writeHead(200, {
      "Content-Type":
        contentTypes[path.extname(absolutePath)] ||
        "application/octet-stream",
    });

    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }

    const reportMatch = url.pathname.match(
      /^\/reports\/([^/]+)$/,
    );

    if (req.method === "GET" && reportMatch) {
      requireSession(req, url);

      const db = await readDb();

      const order = db.orders.find(
        (item) => item.id === reportMatch[1],
      );

      if (!order) {
        return sendJson(res, 404, {
          error: "Orden no encontrada.",
        });
      }

      return sendHtml(res, reportHtml(db, order));
    }

    return await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;

    sendJson(res, status, {
      error: error.message || "Error interno.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`App de mantenimiento lista en puerto ${PORT}`);
});