(() => {
  const SESSION_KEY = "tennisRankAuthSessionV1";
  let config = null;
  let session = null;
  let profile = null;
  let refreshPromise = null;

  const $ = selector => document.querySelector(selector);

  function setAuthStatus(message, error = false) {
    const element = $("#authStatus");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function setButtonBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
    button.setAttribute("aria-busy", String(busy));
  }

  function saveSession(value) {
    session = value;
    if (!value) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const expiresAt = value.expires_at || Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600);
    session = { ...value, expires_at: expiresAt };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function readSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return stored?.access_token && stored?.refresh_token ? stored : null;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  async function loadConfig() {
    if (config) return config;
    const response = await fetch("/api/config", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.supabaseUrl || !payload.publishableKey) {
      throw new Error(payload.error || "Login is not configured yet.");
    }
    config = payload;
    return config;
  }

  async function authRequest(path, options = {}) {
    const settings = await loadConfig();
    const response = await fetch(`${settings.supabaseUrl}/auth/v1${path}`, {
      ...options,
      headers: {
        apikey: settings.publishableKey,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.msg || payload.message || payload.error_description || payload.error || "Authentication failed.");
    return payload;
  }

  async function refreshSession(force = false) {
    if (!session?.refresh_token) throw new Error("Please sign in again.");
    if (!force && Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 90) return session;
    if (!refreshPromise) {
      refreshPromise = authRequest("/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      }).then(value => {
        saveSession(value);
        return session;
      }).finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  async function apiFetch(path, options = {}, retry = true) {
    await refreshSession();
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (response.status === 401 && retry) {
      await refreshSession(true);
      return apiFetch(path, options, false);
    }
    return response;
  }

  async function loadProfile() {
    const response = await apiFetch("/api/session", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Your account is not connected to a team profile yet.");
    profile = payload.profile;
    return profile;
  }

  function showPasswordSetup() {
    $("#loginForm").hidden = true;
    $("#forgotPassword").hidden = true;
    $("#showBootstrap").hidden = true;
    $("#bootstrapForm").hidden = true;
    $("#passwordForm").hidden = false;
    $("#authTitle").textContent = "Choose your password.";
    $("#newPassword").focus();
  }

  function showApp() {
    const isAdmin = profile?.role === "admin";
    document.body.classList.remove("auth-loading", "role-admin", "role-player");
    document.body.classList.add(isAdmin ? "role-admin" : "role-player");
    $("#authGate").hidden = true;
    $("#appShell").hidden = false;
    const name = profile?.full_name || profile?.player_name || session?.user?.email || "Account";
    $("#accountName").textContent = name;
    $("#accountRole").textContent = isAdmin ? "Admin" : "Player";
    $("#accountAvatar").textContent = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "TR";
    const route = isAdmin ? "/admin" : "/player";
    if (location.pathname !== route) history.replaceState(null, "", route + location.hash);
    window.dispatchEvent(new CustomEvent("tennisrank:auth-ready", { detail: { profile, session } }));
  }

  function showLogin(message = "") {
    document.body.classList.remove("auth-loading", "role-admin", "role-player");
    $("#appShell").hidden = true;
    $("#authGate").hidden = false;
    $("#loginForm").hidden = false;
    $("#passwordForm").hidden = true;
    $("#forgotPassword").hidden = false;
    $("#showBootstrap").hidden = false;
    $("#authTitle").textContent = "Welcome back.";
    setAuthStatus(message);
  }

  async function finishSignIn() {
    await loadProfile();
    if (profile?.must_change_password) {
      showLogin();
      showPasswordSetup();
      setAuthStatus("For security, choose a new password before opening your dashboard.");
      return;
    }
    showApp();
  }

  function consumeRedirectSession() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return null;
    saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get("expires_in") || 3600),
      token_type: params.get("token_type") || "bearer",
    });
    const type = params.get("type") || "";
    history.replaceState(null, "", location.pathname);
    return type;
  }

  async function initialize() {
    try {
      await loadConfig();
      const redirectType = consumeRedirectSession();
      session = session || readSession();
      if (redirectType === "invite" || redirectType === "recovery") {
        showLogin();
        showPasswordSetup();
        setAuthStatus(redirectType === "invite" ? "Invitation accepted. Choose a password to finish your account." : "Choose a new password for your account.");
        return;
      }
      if (!session) {
        showLogin();
        return;
      }
      await refreshSession();
      await finishSignIn();
    } catch (error) {
      saveSession(null);
      showLogin(error.message);
    }
  }

  $("#loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#loginButton");
    setButtonBusy(button, true);
    setAuthStatus("Signing in...");
    try {
      const value = await authRequest("/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email: $("#loginEmail").value.trim(), password: $("#loginPassword").value }),
      });
      saveSession(value);
      await finishSignIn();
    } catch (error) {
      saveSession(null);
      setAuthStatus(error.message, true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  $("#passwordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#passwordButton");
    setButtonBusy(button, true);
    try {
      await authRequest("/user", {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ password: $("#newPassword").value }),
      });
      const completed = await apiFetch("/api/session", { method: "PATCH", body: JSON.stringify({ passwordChanged: true }) });
      const completedPayload = await completed.json().catch(() => ({}));
      if (!completed.ok) throw new Error(completedPayload.error || "The password changed, but account setup could not be completed.");
      setAuthStatus("Password saved. Loading your dashboard...");
      await finishSignIn();
    } catch (error) {
      setAuthStatus(error.message, true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  $("#forgotPassword")?.addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim();
    if (!email) {
      setAuthStatus("Enter your email first, then choose Forgot password.", true);
      $("#loginEmail").focus();
      return;
    }
    try {
      await authRequest("/recover", {
        method: "POST",
        body: JSON.stringify({ email, redirect_to: `${location.origin}/player` }),
      });
      setAuthStatus("Password reset email sent. Check your inbox.");
    } catch (error) {
      setAuthStatus(error.message, true);
    }
  });

  $("#showBootstrap")?.addEventListener("click", () => {
    const form = $("#bootstrapForm");
    form.hidden = !form.hidden;
    if (!form.hidden) $("#bootstrapEmail").focus();
  });

  $("#bootstrapForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#bootstrapButton");
    setButtonBusy(button, true);
    setAuthStatus("Creating the first admin account...");
    try {
      const response = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": $("#bootstrapToken").value },
        body: JSON.stringify({ email: $("#bootstrapEmail").value.trim(), password: $("#bootstrapPassword").value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Admin setup failed.");
      $("#bootstrapForm").hidden = true;
      setAuthStatus("Admin account created. Sign in with the email and password you just chose.");
    } catch (error) {
      setAuthStatus(error.message, true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  $("#accountMenu")?.addEventListener("click", async () => {
    try {
      if (session?.access_token) {
        await authRequest("/logout", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      }
    } catch {
      // Clear the local session even if the remote sign-out call is unavailable.
    }
    saveSession(null);
    profile = null;
    location.assign("/");
  });

  window.TennisRankAuth = {
    fetch: apiFetch,
    getProfile: () => profile,
    getSession: () => session,
  };

  initialize();
})();
