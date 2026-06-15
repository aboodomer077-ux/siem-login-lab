/**
 * Frontend for GitHub Pages.
 * Replace API_BASE with your Cloudflare Worker URL after deployment.
 */
const API_BASE = "https://noisy-sun-fec0.aboodomer077.workers.dev";

const storage = {
  get token() {
    return sessionStorage.getItem("auth_token");
  },
  set token(value) {
    sessionStorage.setItem("auth_token", value);
  },
  clear() {
    sessionStorage.removeItem("auth_token");
  }
};

function localLog(event) {
  const list = JSON.parse(localStorage.getItem("local_audit") || "[]");
  list.unshift({
    timestamp: new Date().toISOString(),
    ...event
  });
  localStorage.setItem("local_audit", JSON.stringify(list.slice(0, 50)));
  renderLocalAudit();
}

function renderLocalAudit() {
  const box = document.getElementById("localAudit");
  if (!box) return;

  const list = JSON.parse(localStorage.getItem("local_audit") || "[]");
  box.innerHTML = list.map(item => {
    return `<div class="audit-line">${escapeHtml(JSON.stringify(item, null, 2))}</div>`;
  }).join("");

  const authCount = list.filter(x => String(x.event_type || "").includes("login") || x.event_type === "logout").length;
  const alertCount = list.filter(x => x.alert === true || x.severity === "high").length;

  const authEl = document.getElementById("authCount");
  const auditEl = document.getElementById("auditCount");
  const alertEl = document.getElementById("alertCount");

  if (authEl) authEl.textContent = authCount;
  if (auditEl) auditEl.textContent = list.length;
  if (alertEl) alertEl.textContent = alertCount;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, payload = {}, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.auth && storage.token ? { "Authorization": `Bearer ${storage.token}` } : {})
  };

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (networkError) {
    throw new Error(`تعذر الاتصال بالـ API. تأكد من رابط Cloudflare Worker: ${API_BASE}`);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.message || "Request failed");
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function audit(eventType, data = {}, severity = "info") {
  const payload = {
    event_type: eventType,
    severity,
    page: location.pathname,
    referrer: document.referrer || null,
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...data
  };

  localLog(payload);

  try {
    await api("/audit", payload, { auth: true });
  } catch (err) {
    localLog({
      event_type: "audit_forward_failed",
      severity: "medium",
      message: err.message,
      status: err.status || null
    });
  }
}

function setupLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  const msg = document.getElementById("message");
  const btn = document.getElementById("loginBtn");

  audit("page_view", { page_name: "login" }).catch(() => {});

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    msg.className = "message";
    msg.textContent = "جاري التحقق...";
    btn.disabled = true;

    localLog({ event_type: "login_attempt_frontend", username, severity: "info" });

    try {
      const data = await api("/login", { username, password });
      storage.token = data.token;

      msg.className = "message success";
      msg.textContent = "تم تسجيل الدخول بنجاح.";
      localLog({ event_type: "login_success_frontend", username, severity: "info" });

      setTimeout(() => {
        location.href = "./dashboard.html";
      }, 600);
    } catch (err) {
      msg.className = "message error";
      msg.textContent = err.message || "فشل تسجيل الدخول.";
      localLog({
        event_type: "login_failed_frontend",
        username,
        severity: "medium",
        message: err.message,
        alert: err.status === 429
      });
    } finally {
      btn.disabled = false;
    }
  });
}

function setupDashboardPage() {
  const logoutBtn = document.getElementById("logoutBtn");
  const sendTestEvent = document.getElementById("sendTestEvent");

  if (!logoutBtn && !sendTestEvent) return;

  renderLocalAudit();

  if (!storage.token) {
    localLog({ event_type: "dashboard_without_token", severity: "high", alert: true });
    location.href = "./index.html";
    return;
  }

  audit("page_view", { page_name: "dashboard" }).catch(() => {});

  sendTestEvent?.addEventListener("click", async () => {
    await audit("sensitive_button_click", {
      button_id: "sendTestEvent",
      message: "User triggered a test security event"
    }, "info");
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      await audit("logout", { reason: "user_clicked_logout" });
    } finally {
      storage.clear();
      location.href = "./index.html";
    }
  });
}

setupLoginPage();
setupDashboardPage();
