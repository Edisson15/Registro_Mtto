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
  const candidate = crypto.pbkdf2Sync(String(password), salt, Number(iterations), 32, "sha256");
  const stored = Buffer.from(hash, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function passwordNeedsMigration(storedPassword) {
  return Boolean(storedPassword && !storedPassword.startsWith("pbkdf2_sha256$"));
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
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
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
  if (header.startsWith("Bearer ")) return header.slice(7);
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
    const techUser = db.users.find((item) => item.id === technician.userId);
    return {
      ...technician,
      username: techUser?.username || "",
    };
  });

  return {
    user: sanitizeUser(user),
    technicians: user.role === "admin" ? technicians : technicians.filter((technician) => technician.id === user.technicianId),
    orders: user.role === "admin" ? db.orders : db.orders.filter((order) => order.assignedTo === user.technicianId),
    activities: db.activities,
  };
}

function getTechnician(db, technicianId) {
  return db.technicians.find((technician) => technician.id === technicianId);
}

async function notify(db, type, order) {
  const technician = getTechnician(db, order.assignedTo);
  const message = `${order.code}: ${order.asset} en ${order.location}. Estado: ${order.status}.`;
  const logEntry = {
    id: uid("notification"),
    type,
    orderId: order.id,
    technicianId: order.assignedTo,
    message,
    createdAt: new Date().toISOString(),
    channels: [],
  };

  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && technician?.phone) {
    const response = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: technician.phone,
        type: "text",
        text: { body: message },
      }),
    });
    logEntry.channels.push({ channel: "whatsapp", ok: response.ok, status: response.status });
  }

  if (process.env.NOTIFICATION_WEBHOOK_URL) {
    const response = await fetch(process.env.NOTIFICATION_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, order, technician, message }),
    });
    logEntry.channels.push({ channel: "webhook", ok: response.ok, status: response.status });
  }

  if (!logEntry.channels.length) {
    logEntry.channels.push({ channel: "console", ok: true, status: "configured-later" });
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
  const intervention = order.interventionDescription || "Sin descripcion de intervencion registrada.";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Reporte ${order.code}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #17211d; }
      header { border-bottom: 2px solid #1e6f5c; margin-bottom: 24px; padding-bottom: 16px; }
      h1 { margin: 0 0 8px; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
      .box { border: 1px solid #d9e4de; border-radius: 8px; padding: 12px; }
      .label { color: #60716a; font-size: 12px; font-weight: 700; text-transform: uppercase; }
      img { width: 180px; height: 180px; object-fit: cover; border: 1px solid #d9e4de; border-radius: 8px; margin: 0 10px 10px 0; }
      button { margin-bottom: 20px; padding: 10px 14px; border: 0; border-radius: 8px; background: #1e6f5c; color: white; font-weight: 700; }
      @media print { button { display: none; } body { margin: 0; } }
    </style>
  </head>
  <body>
    <button onclick="window.print()">Guardar como PDF</button>
    <header>
      <h1>Reporte de orden ${escapeHtml(order.code)}</h1>
      <p>Orden de mantenimiento finalizada</p>
    </header>
    <section class="grid">
      <div class="box"><div class="label">Equipo</div><strong>${escapeHtml(order.asset)}</strong></div>
      <div class="box"><div class="label">Ubicacion</div><strong>${escapeHtml(order.location)}</strong></div>
      <div class="box"><div class="label">Tecnico</div><strong>${escapeHtml(technician?.name || "Sin asignar")}</strong></div>
      <div class="box"><div class="label">Finalizada</div><strong>${order.finishedAt ? new Date(order.finishedAt).toLocaleString("es-CO") : ""}</strong></div>
    </section>
    <section>
      <h2>Solicitud inicial</h2>
      <p>${escapeHtml(order.description)}</p>
    </section>
    <section>
      <h2>Intervencion realizada</h2>
      <p>${escapeHtml(intervention)}</p>
    </section>
    <section>
      <h2>Evidencias</h2>
      ${evidence || "<p>Sin evidencias adjuntas.</p>"}
    </section>
  </body>
</html>`;
}

async function handleApi(req, res, url) {
  const db = await readDb();

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const user = db.users.find((item) => item.username === body.username && verifyPassword(body.password, item.password));
    if (!user) return sendJson(res, 401, { error: "Usuario o contrasena incorrectos." });

    if (passwordNeedsMigration(user.password)) {
      user.password = hashPassword(body.password);
      await writeDb(db);
    }

    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, sanitizeUser(user));
    return sendJson(res, 200, { token, user: sanitizeUser(user) });
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
    addActivity(db, `${order.code} creada y ${order.assignedTo ? "enviada al tecnico asignado" : "dejada pendiente"}.`, order.id);
    await notify(db, "order-created", order);
    await writeDb(db);
    return sendJson(res, 201, { order });
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === "PUT" && orderMatch) {
    requireAdmin(user);
    const body = await readBody(req);
    const order = db.orders.find((item) => item.id === orderMatch[1]);
    if (!order) return sendJson(res, 404, { error: "Orden no encontrada." });

    const assignedTo = String(body.assignedTo || "").trim();
    if (assignedTo && !db.technicians.some((technician) => technician.id === assignedTo)) {
      return sendJson(res, 400, { error: "El tecnico asignado no existe." });
    }

    const validStatuses = ["pending", "assigned", "in-progress", "done"];
    const status = validStatuses.includes(body.status) ? body.status : order.status;
    order.asset = String(body.asset || "").trim();
    order.location = String(body.location || "").trim();
    order.priority = String(body.priority || "Media").trim();
    order.assignedTo = assignedTo;
    order.status = assignedTo ? status === "pending" ? "assigned" : status : "pending";
    order.description = String(body.description || "").trim();
    order.interventionDescription = String(body.interventionDescription || "").trim();
    order.finishedAt = order.status === "done" ? order.finishedAt || new Date().toISOString() : null;

    if (!order.asset || !order.location || !order.description) {
      return sendJson(res, 400, { error: "Equipo, ubicacion y descripcion son obligatorios." });
    }
    if (order.status === "done" && !order.interventionDescription) {
      return sendJson(res, 400, { error: "Para finalizar la orden debes registrar la intervencion." });
    }

    addActivity(db, `${order.code} fue editada por el coordinador.`, order.id);
    await notify(db, "order-updated", order);
    await writeDb(db);
    return sendJson(res, 200, { order });
  }

  if (req.method === "POST" && url.pathname === "/api/technicians") {
    requireAdmin(user);
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const name = String(body.name || "").trim();
    if (!name || !username || !password) {
      return sendJson(res, 400, { error: "Nombre, usuario y contrasena son obligatorios." });
    }
    if (db.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      return sendJson(res, 409, { error: "Ya existe un usuario con ese nombre de acceso." });
    }

    const technicianId = uid("tech");
    const userId = uid("user");
    const techUser = { id: userId, name, username, password: hashPassword(password), role: "tech", technicianId };
    const technician = {
      id: technicianId,
      name,
      userId,
      phone: body.phone || "",
    };
    db.users.push(techUser);
    db.technicians.push(technician);
    addActivity(db, `${technician.name} fue agregado al equipo tecnico.`);
    await writeDb(db);
    return sendJson(res, 201, { technician });
  }

  const technicianMatch = url.pathname.match(/^\/api\/technicians\/([^/]+)$/);
  if (technicianMatch && req.method === "PUT") {
    requireAdmin(user);
    const body = await readBody(req);
    const technician = db.technicians.find((item) => item.id === technicianMatch[1]);
    if (!technician) return sendJson(res, 404, { error: "Tecnico no encontrado." });

    const techUser = db.users.find((item) => item.id === technician.userId);
    const username = String(body.username || "").trim();
    const name = String(body.name || "").trim();
    if (!name || !username) {
      return sendJson(res, 400, { error: "Nombre y usuario son obligatorios." });
    }
    if (db.users.some((item) => item.id !== techUser?.id && item.username.toLowerCase() === username.toLowerCase())) {
      return sendJson(res, 409, { error: "Ya existe un usuario con ese nombre de acceso." });
    }

    technician.name = name;
    technician.phone = body.phone || "";

    if (techUser) {
      techUser.name = name;
      techUser.username = username;
      if (body.password) techUser.password = hashPassword(String(body.password));
    } else {
      const userId = uid("user");
      technician.userId = userId;
      db.users.push({
        id: userId,
        name,
        username,
        password: hashPassword(String(body.password || "1234")),
        role: "tech",
        technicianId: technician.id,
      });
    }

    addActivity(db, `${technician.name} fue actualizado en el equipo tecnico.`);
    await writeDb(db);
    return sendJson(res, 200, { technician });
  }

  if (technicianMatch && req.method === "DELETE") {
    requireAdmin(user);
    const technician = db.technicians.find((item) => item.id === technicianMatch[1]);
    if (!technician) return sendJson(res, 404, { error: "Tecnico no encontrado." });

    const hasActiveOrders = db.orders.some((order) => order.assignedTo === technician.id && order.status !== "done");
    if (hasActiveOrders) {
      return sendJson(res, 409, { error: "No puedes eliminar un tecnico con ordenes activas." });
    }

    db.technicians = db.technicians.filter((item) => item.id !== technician.id);
    db.users = db.users.filter((item) => item.id !== technician.userId);
    for (const [token, sessionUser] of sessions.entries()) {
      if (sessionUser.technicianId === technician.id) sessions.delete(token);
    }
    addActivity(db, `${technician.name} fue eliminado del equipo tecnico.`);
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/seed") {
    requireAdmin(user);
    const samples = [
      ["Bomba hidraulica 2", "Linea de produccion A", "Alta", "Vibracion anormal y fuga leve en sello.", "tech-1"],
      ["Aire acondicionado", "Oficina administrativa", "Media", "No enfria correctamente durante la tarde.", "tech-2"],
      ["Tablero electrico", "Subestacion", "Alta", "Revisar temperatura alta en breaker principal.", "tech-3"],
    ];
    samples.forEach(([asset, location, priority, description, assignedTo]) => {
      db.orders.push({
        id: uid("order"),
        code: nextOrderCode(db),
        asset,
        location,
        priority,
        assignedTo,
        description,
        status: "assigned",
        interventionDescription: "",
        evidence: [],
        createdAt: new Date().toISOString(),
        finishedAt: null,
      });
    });
    addActivity(db, "Se cargaron ordenes de ejemplo para probar el flujo.");
    await writeDb(db);
    return sendJson(res, 201, { ok: true });
  }

  const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    const body = await readBody(req);
    const order = db.orders.find((item) => item.id === statusMatch[1]);
    if (!order) return sendJson(res, 404, { error: "Orden no encontrada." });
    if (user.role !== "admin" && order.assignedTo !== user.technicianId) {
      return sendJson(res, 403, { error: "Esta orden esta asignada a otro tecnico." });
    }
    order.status = body.status;
    if (body.status === "done") {
      order.finishedAt = new Date().toISOString();
      order.interventionDescription = String(body.interventionDescription || "").trim();
    }
    addActivity(db, `${order.code} cambio a ${body.status}.`, order.id);
    await notify(db, `order-${body.status}`, order);
    await writeDb(db);
    return sendJson(res, 200, { order });
  }

  const evidenceMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/evidence$/);
  if (req.method === "POST" && evidenceMatch) {
    const body = await readBody(req);
    const order = db.orders.find((item) => item.id === evidenceMatch[1]);
    if (!order) return sendJson(res, 404, { error: "Orden no encontrada." });
    if (user.role !== "admin" && order.assignedTo !== user.technicianId) {
      return sendJson(res, 403, { error: "Esta orden esta asignada a otro tecnico." });
    }
    order.evidence.push({
      id: uid("evidence"),
      name: body.name,
      dataUrl: body.dataUrl,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.id,
    });
    addActivity(db, `${user.name} adjunto evidencia a ${order.code}.`, order.id);
    await writeDb(db);
    return sendJson(res, 201, { order });
  }

  return sendJson(res, 404, { error: "Ruta no encontrada." });
}

async function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(ROOT, filePath);

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const file = await fs.readFile(absolutePath);
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(absolutePath)] || "application/octet-stream" });
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

    const reportMatch = url.pathname.match(/^\/reports\/([^/]+)$/);
    if (req.method === "GET" && reportMatch) {
      requireSession(req, url);
      const db = await readDb();
      const order = db.orders.find((item) => item.id === reportMatch[1]);
      if (!order) return sendJson(res, 404, { error: "Orden no encontrada." });
      return sendHtml(res, reportHtml(db, order));
    }

    return await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { error: error.message || "Error interno." });
  }
});

server.listen(PORT, () => {
  console.log(`App de mantenimiento lista en puerto ${PORT}`);
});
