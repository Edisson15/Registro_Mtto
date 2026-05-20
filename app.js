const SESSION_KEY = "maintenanceOrdersApp:session";

const statusLabels = {
  pending: "Pendiente",
  assigned: "Asignada",
  "in-progress": "En ejecucion",
  done: "Finalizada",
};

const state = {
  session: JSON.parse(localStorage.getItem(SESSION_KEY) || "null"),
  role: null,
  activeTechnicianId: null,
  technicians: [],
  orders: [],
  activities: [],
};

const elements = {
  loginScreen: document.querySelector("#loginScreen"),
  appShell: document.querySelector("#appShell"),
  loginForm: document.querySelector("#loginForm"),
  loginError: document.querySelector("#loginError"),
  userName: document.querySelector("#userName"),
  userRole: document.querySelector("#userRole"),
  logoutButton: document.querySelector("#logoutButton"),
  technicianSelect: document.querySelector("#technicianSelect"),
  statusFilter: document.querySelector("#statusFilter"),
  searchInput: document.querySelector("#searchInput"),
  metrics: document.querySelector("#metrics"),
  activityPanel: document.querySelector("#activityPanel"),
  activityFeed: document.querySelector("#activityFeed"),
  activityCount: document.querySelector("#activityCount"),
  ordersList: document.querySelector("#ordersList"),
  orderForm: document.querySelector("#orderForm"),
  assignedInput: document.querySelector("#assignedInput"),
  priorityInput: document.querySelector("#priorityInput"),
  technicianForm: document.querySelector("#technicianForm"),
  technicianNameInput: document.querySelector("#technicianNameInput"),
  technicianUsernameInput: document.querySelector("#technicianUsernameInput"),
  technicianPasswordInput: document.querySelector("#technicianPasswordInput"),
  technicianPhoneInput: document.querySelector("#technicianPhoneInput"),
  teamList: document.querySelector("#teamList"),
  teamCount: document.querySelector("#teamCount"),
  seedDataButton: document.querySelector("#seedDataButton"),
  orderDialog: document.querySelector("#orderDialog"),
  orderDetail: document.querySelector("#orderDetail"),
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authHeaders() {
  return state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    logout();
    throw new Error("Sesion vencida. Ingresa de nuevo.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "No se pudo completar la accion.");
  }

  return payload;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getTechnicianName(id) {
  return state.technicians.find((technician) => technician.id === id)?.name || "Sin asignar";
}

function getOrder(orderId) {
  return state.orders.find((order) => order.id === orderId);
}

function canManage() {
  return state.role === "admin";
}

function visibleOrders() {
  const status = elements.statusFilter.value;
  const searchTerm = elements.searchInput.value.trim().toLowerCase();

  return state.orders
    .filter((order) => canManage() || order.assignedTo === state.activeTechnicianId)
    .filter((order) => status === "all" || order.status === status)
    .filter((order) => {
      const haystack = `${order.code} ${order.asset} ${order.location} ${order.description} ${order.interventionDescription || ""}`.toLowerCase();
      return !searchTerm || haystack.includes(searchTerm);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function bootstrap() {
  if (!state.session) {
    showLogin();
    return;
  }

  try {
    const data = await api("/api/bootstrap");
    state.role = data.user.role;
    state.activeTechnicianId = data.user.technicianId || data.technicians[0]?.id || null;
    state.technicians = data.technicians;
    state.orders = data.orders;
    state.activities = data.activities;
    state.session.user = data.user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    showApp();
    render();
  } catch (error) {
    elements.loginError.textContent = error.message;
    showLogin();
  }
}

function showLogin() {
  elements.loginScreen.classList.remove("hidden");
  elements.appShell.classList.add("hidden");
}

function showApp() {
  elements.loginScreen.classList.add("hidden");
  elements.appShell.classList.remove("hidden");
  elements.userName.textContent = state.session.user.name;
  elements.userRole.textContent = canManage() ? "Coordinador" : "Tecnico";
}

function logout() {
  state.session = null;
  state.role = null;
  state.activeTechnicianId = null;
  localStorage.removeItem(SESSION_KEY);
  showLogin();
}

function renderTechnicianOptions() {
  const options = state.technicians
    .map((technician) => `<option value="${technician.id}">${escapeHtml(technician.name)}</option>`)
    .join("");

  elements.technicianSelect.innerHTML = options;
  elements.assignedInput.innerHTML = `<option value="">Sin asignar</option>${options}`;
  elements.technicianSelect.value = state.activeTechnicianId || "";
}

function renderIdentity() {
  document.querySelectorAll(".tech-only").forEach((element) => {
    element.classList.add("hidden");
  });

  document.querySelector('[data-tab="new-order"]').classList.toggle("hidden", !canManage());
  document.querySelector('[data-tab="team"]').classList.toggle("hidden", !canManage());
  elements.seedDataButton.classList.toggle("hidden", !canManage());
  elements.activityPanel.classList.toggle("hidden", !canManage());
}

function renderMetrics() {
  const orders = canManage()
    ? state.orders
    : state.orders.filter((order) => order.assignedTo === state.activeTechnicianId);

  const metrics = [
    ["Pendientes", orders.filter((order) => order.status === "pending").length],
    ["Asignadas", orders.filter((order) => order.status === "assigned").length],
    ["En ejecucion", orders.filter((order) => order.status === "in-progress").length],
    ["Finalizadas", orders.filter((order) => order.status === "done").length],
  ];

  elements.metrics.innerHTML = metrics
    .map(([label, count]) => `<article class="metric-card"><strong>${count}</strong><span>${label}</span></article>`)
    .join("");
}

function renderActivities() {
  elements.activityCount.textContent = `${state.activities.length} eventos`;
  elements.activityFeed.innerHTML = state.activities.length
    ? state.activities
        .map(
          (activity) => `
            <article class="activity-item">
              <p>${escapeHtml(activity.text)}</p>
              <span>${formatDate(activity.createdAt)}</span>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">Aun no hay actividad registrada.</div>`;
}

function orderStatusActions(order) {
  const canStart = !canManage() && order.status === "assigned";
  const canFinish = !canManage() && order.status === "in-progress";
  const reportButton = order.status === "done"
    ? `<button class="status-button" type="button" data-action="report" data-id="${order.id}">Reporte PDF</button>`
    : "";

  return `
    <div class="actions-row">
      <button class="status-button" type="button" data-action="detail" data-id="${order.id}">Ver detalle</button>
      ${canManage() ? `<button class="status-button" type="button" data-action="edit-order" data-id="${order.id}">Editar</button>` : ""}
      ${canStart ? `<button class="status-button" type="button" data-action="start" data-id="${order.id}">Iniciar</button>` : ""}
      ${canFinish ? `<button class="status-button done" type="button" data-action="finish" data-id="${order.id}">Finalizar</button>` : ""}
      ${reportButton}
    </div>
  `;
}

function renderOrders() {
  const orders = visibleOrders();
  elements.ordersList.innerHTML = orders.length
    ? orders
        .map(
          (order) => `
            <article class="order-card">
              <header>
                <div>
                  <h3>${escapeHtml(order.code)} - ${escapeHtml(order.asset)}</h3>
                  <p>${escapeHtml(order.location)}</p>
                </div>
                <span class="tag ${order.status === "done" ? "done" : ""}">${statusLabels[order.status]}</span>
              </header>
              <p>${escapeHtml(order.description)}</p>
              <div class="tag-row">
                <span class="tag ${order.priority === "Alta" ? "high" : ""}">${escapeHtml(order.priority)}</span>
                <span class="tag">${escapeHtml(getTechnicianName(order.assignedTo))}</span>
                <span class="tag">${order.evidence.length} evidencias</span>
              </div>
              ${orderStatusActions(order)}
            </article>
          `,
        )
        .join("")
    : `<div class="panel empty-state">No hay ordenes para esta vista.</div>`;
}

function renderTeam() {
  elements.teamCount.textContent = `${state.technicians.length} personas`;
  elements.teamList.innerHTML = state.technicians
    .map((technician) => {
      const assigned = state.orders.filter((order) => order.assignedTo === technician.id && order.status !== "done").length;
      return `
        <article class="team-member">
          <div>
            <p><strong>${escapeHtml(technician.name)}</strong></p>
            <span>${assigned} ordenes activas · usuario: ${escapeHtml(technician.username || "sin usuario")}</span>
            <span>${escapeHtml(technician.phone || "sin WhatsApp")}</span>
          </div>
          <div class="actions-row">
            <button class="status-button" type="button" data-action="edit-tech" data-id="${technician.id}">Editar</button>
            <button class="status-button danger" type="button" data-action="delete-tech" data-id="${technician.id}">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function render() {
  renderTechnicianOptions();
  renderIdentity();
  renderMetrics();
  renderActivities();
  renderOrders();
  renderTeam();
}

function setActiveTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  document.querySelector(`#${tabName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}Screen`).classList.add("active");
}

async function refreshData() {
  const data = await api("/api/bootstrap");
  state.technicians = data.technicians;
  state.orders = data.orders;
  state.activities = data.activities;
  render();
}

async function createOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;

  await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      asset: form.assetInput.value.trim(),
      location: form.locationInput.value.trim(),
      priority: form.priorityInput.value,
      assignedTo: elements.assignedInput.value,
      description: form.descriptionInput.value.trim(),
    }),
  });

  form.reset();
  elements.priorityInput.value = "Media";
  setActiveTab("orders");
  await refreshData();
}

async function updateOrderStatus(orderId, status, descriptionFromForm = "") {
  let interventionDescription = descriptionFromForm;
  if (status === "done") {
    interventionDescription ||= window.prompt("Describe la intervencion realizada antes de finalizar la orden:");
    if (!interventionDescription?.trim()) {
      window.alert("Para finalizar la orden debes escribir la descripcion de la intervencion.");
      return;
    }
  }

  await api(`/api/orders/${orderId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, interventionDescription: interventionDescription.trim() }),
  });
  await refreshData();
}

function openOrderDetail(orderId) {
  const order = getOrder(orderId);
  if (!order) return;

  const evidenceInput = !canManage() && order.status !== "done"
    ? `
      <label for="evidenceInput">Subir evidencia</label>
      <input id="evidenceInput" type="file" accept="image/*" capture="environment" />
    `
    : "";

  const intervention = order.interventionDescription
    ? `
      <section class="detail-section">
        <h3>Intervencion realizada</h3>
        <p>${escapeHtml(order.interventionDescription)}</p>
      </section>
    `
    : "";
  const finishPanel = !canManage() && order.status === "in-progress"
    ? `
      <section class="detail-section">
        <label for="interventionInput">Descripcion de la intervencion</label>
        <textarea id="interventionInput" rows="4" placeholder="Describe el trabajo realizado, repuestos usados y observaciones"></textarea>
        <button class="primary-button" type="button" id="finishFromDetailButton">Finalizar orden</button>
      </section>
    `
    : "";

  elements.orderDetail.innerHTML = `
    <h2>${escapeHtml(order.code)} - ${escapeHtml(order.asset)}</h2>
    <p>${escapeHtml(order.description)}</p>
    <div class="detail-grid">
      <span class="tag">${escapeHtml(order.location)}</span>
      <span class="tag">${escapeHtml(order.priority)}</span>
      <span class="tag">${statusLabels[order.status]}</span>
      <span class="tag">${escapeHtml(getTechnicianName(order.assignedTo))}</span>
    </div>
    ${intervention}
    ${finishPanel}
    ${evidenceInput}
    <div class="evidence-list" id="evidencePreview">
      ${
        order.evidence.length
          ? order.evidence
              .map(
                (item) => `
                  <button class="evidence-button" type="button" data-action="evidence" data-order-id="${order.id}" data-evidence-id="${item.id}">
                    <img class="evidence-item" alt="Evidencia ${escapeHtml(item.name)}" src="${item.dataUrl}" />
                  </button>
                `,
              )
              .join("")
          : `<div class="empty-state">Sin evidencias adjuntas.</div>`
      }
    </div>
  `;

  const input = elements.orderDetail.querySelector("#evidenceInput");
  input?.addEventListener("change", (event) => attachEvidence(event, order.id));
  elements.orderDetail.querySelector("#finishFromDetailButton")?.addEventListener("click", () => {
    const description = elements.orderDetail.querySelector("#interventionInput").value;
    updateOrderStatus(order.id, "done", description);
  });
  elements.orderDetail.querySelectorAll('[data-action="evidence"]').forEach((button) => {
    button.addEventListener("click", () => openEvidence(button.dataset.orderId, button.dataset.evidenceId));
  });
  if (!elements.orderDialog.open) {
    elements.orderDialog.showModal();
  }
}

function openEvidence(orderId, evidenceId) {
  const order = getOrder(orderId);
  const evidence = order?.evidence.find((item) => item.id === evidenceId);
  if (!order || !evidence) return;

  elements.orderDetail.innerHTML = `
    <h2>Evidencia ${escapeHtml(order.code)}</h2>
    <p>${escapeHtml(evidence.name || "Imagen adjunta")}</p>
    <img class="evidence-full" alt="Evidencia ampliada" src="${evidence.dataUrl}" />
    <div class="actions-row">
      <button class="status-button" type="button" id="backToOrderButton">Volver al detalle</button>
      <a class="status-button download-link" href="${evidence.dataUrl}" download="${escapeHtml(evidence.name || `${order.code}-evidencia.jpg`)}">Descargar imagen</a>
    </div>
  `;

  elements.orderDetail.querySelector("#backToOrderButton").addEventListener("click", () => openOrderDetail(orderId));
  if (!elements.orderDialog.open) {
    elements.orderDialog.showModal();
  }
}

function openOrderEditor(orderId) {
  const order = getOrder(orderId);
  if (!order || !canManage()) return;

  const options = state.technicians
    .map((technician) => {
      const selected = technician.id === order.assignedTo ? "selected" : "";
      return `<option value="${technician.id}" ${selected}>${escapeHtml(technician.name)}</option>`;
    })
    .join("");

  elements.orderDetail.innerHTML = `
    <h2>Editar orden ${escapeHtml(order.code)}</h2>
    <section class="detail-section">
      <label for="editOrderAsset">Equipo o activo</label>
      <input id="editOrderAsset" value="${escapeHtml(order.asset)}" />
      <label for="editOrderLocation">Ubicacion</label>
      <input id="editOrderLocation" value="${escapeHtml(order.location)}" />
      <label for="editOrderPriority">Prioridad</label>
      <select id="editOrderPriority">
        <option value="Alta" ${order.priority === "Alta" ? "selected" : ""}>Alta</option>
        <option value="Media" ${order.priority === "Media" ? "selected" : ""}>Media</option>
        <option value="Baja" ${order.priority === "Baja" ? "selected" : ""}>Baja</option>
      </select>
      <label for="editOrderAssigned">Tecnico asignado</label>
      <select id="editOrderAssigned">
        <option value="">Sin asignar</option>
        ${options}
      </select>
      <label for="editOrderStatus">Estado</label>
      <select id="editOrderStatus">
        <option value="pending" ${order.status === "pending" ? "selected" : ""}>Pendiente</option>
        <option value="assigned" ${order.status === "assigned" ? "selected" : ""}>Asignada</option>
        <option value="in-progress" ${order.status === "in-progress" ? "selected" : ""}>En ejecucion</option>
        <option value="done" ${order.status === "done" ? "selected" : ""}>Finalizada</option>
      </select>
      <label for="editOrderDescription">Descripcion del problema</label>
      <textarea id="editOrderDescription" rows="4">${escapeHtml(order.description)}</textarea>
      <label for="editOrderIntervention">Intervencion realizada</label>
      <textarea id="editOrderIntervention" rows="4">${escapeHtml(order.interventionDescription || "")}</textarea>
      <button class="primary-button" type="button" id="saveOrderButton">Guardar cambios</button>
    </section>
  `;

  elements.orderDetail.querySelector("#saveOrderButton").addEventListener("click", async () => {
    await api(`/api/orders/${order.id}`, {
      method: "PUT",
      body: JSON.stringify({
        asset: elements.orderDetail.querySelector("#editOrderAsset").value.trim(),
        location: elements.orderDetail.querySelector("#editOrderLocation").value.trim(),
        priority: elements.orderDetail.querySelector("#editOrderPriority").value,
        assignedTo: elements.orderDetail.querySelector("#editOrderAssigned").value,
        status: elements.orderDetail.querySelector("#editOrderStatus").value,
        description: elements.orderDetail.querySelector("#editOrderDescription").value.trim(),
        interventionDescription: elements.orderDetail.querySelector("#editOrderIntervention").value.trim(),
      }),
    });
    elements.orderDialog.close();
    await refreshData();
  });

  if (!elements.orderDialog.open) {
    elements.orderDialog.showModal();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

async function attachEvidence(event, orderId) {
  const file = event.target.files?.[0];
  if (!file) return;

  const dataUrl = await readFileAsDataUrl(file);
  await api(`/api/orders/${orderId}/evidence`, {
    method: "POST",
    body: JSON.stringify({ name: file.name, dataUrl }),
  });
  await refreshData();
  openOrderDetail(orderId);
}

async function seedData() {
  await api("/api/seed", { method: "POST", body: "{}" });
  await refreshData();
}

function openReport(orderId) {
  const token = encodeURIComponent(state.session.token);
  window.open(`/reports/${orderId}?token=${token}`, "_blank", "noopener");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.textContent = "";

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: event.currentTarget.username.value.trim(),
        password: event.currentTarget.password.value,
      }),
    });
    state.session = data;
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    await bootstrap();
  } catch (error) {
    elements.loginError.textContent = error.message;
  }
});

elements.logoutButton.addEventListener("click", logout);

elements.technicianSelect.addEventListener("change", (event) => {
  if (!canManage()) return;
  state.activeTechnicianId = event.target.value;
  render();
});

elements.statusFilter.addEventListener("change", renderOrders);
elements.searchInput.addEventListener("input", renderOrders);
elements.orderForm.addEventListener("submit", createOrder);
elements.seedDataButton.addEventListener("click", seedData);

elements.technicianForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.technicianNameInput.value.trim();
  const username = elements.technicianUsernameInput.value.trim();
  const password = elements.technicianPasswordInput.value.trim();
  const phone = elements.technicianPhoneInput.value.trim();
  if (!name || !username || !password) return;

  await api("/api/technicians", {
    method: "POST",
    body: JSON.stringify({ name, username, password, phone }),
  });
  event.currentTarget.reset();
  await refreshData();
});

elements.teamList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const technician = state.technicians.find((item) => item.id === button.dataset.id);
  if (!technician) return;

  if (button.dataset.action === "edit-tech") {
    openTechnicianEditor(technician);
  }

  if (button.dataset.action === "delete-tech") {
    const hasActiveOrders = state.orders.some((order) => order.assignedTo === technician.id && order.status !== "done");
    if (hasActiveOrders) {
      window.alert("No puedes eliminar un tecnico con ordenes activas. Reasigna o finaliza esas ordenes primero.");
      return;
    }
    if (!window.confirm(`Eliminar a ${technician.name} y su acceso?`)) return;

    await api(`/api/technicians/${technician.id}`, { method: "DELETE" });
    await refreshData();
  }
});

function openTechnicianEditor(technician) {
  elements.orderDetail.innerHTML = `
    <h2>Editar tecnico</h2>
    <section class="detail-section">
      <label for="editTechName">Nombre</label>
      <input id="editTechName" value="${escapeHtml(technician.name)}" />
      <label for="editTechUsername">Usuario</label>
      <input id="editTechUsername" value="${escapeHtml(technician.username || "")}" />
      <label for="editTechPassword">Nueva contrasena</label>
      <input id="editTechPassword" type="password" placeholder="Dejar vacia para conservar" />
      <label for="editTechPhone">WhatsApp</label>
      <input id="editTechPhone" inputmode="tel" value="${escapeHtml(technician.phone || "")}" />
      <button class="primary-button" type="button" id="saveTechnicianButton">Guardar cambios</button>
    </section>
  `;

  elements.orderDetail.querySelector("#saveTechnicianButton").addEventListener("click", async () => {
    await api(`/api/technicians/${technician.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: elements.orderDetail.querySelector("#editTechName").value.trim(),
        username: elements.orderDetail.querySelector("#editTechUsername").value.trim(),
        password: elements.orderDetail.querySelector("#editTechPassword").value.trim(),
        phone: elements.orderDetail.querySelector("#editTechPhone").value.trim(),
      }),
    });
    elements.orderDialog.close();
    await refreshData();
  });

  if (!elements.orderDialog.open) {
    elements.orderDialog.showModal();
  }
}

elements.ordersList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  if (action === "detail") openOrderDetail(id);
  if (action === "edit-order") openOrderEditor(id);
  if (action === "start") updateOrderStatus(id, "in-progress");
  if (action === "finish") updateOrderStatus(id, "done");
  if (action === "report") openReport(id);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

bootstrap();
