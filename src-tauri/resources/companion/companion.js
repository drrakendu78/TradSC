(function () {
  var THEME_KEY = "startrad-companion-theme";
  var IOS_BANNER_KEY = "startrad-companion-ios-banner-dismissed";
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var refreshState = {
    startY: 0,
    armed: false,
    pulling: false,
    busy: false
  };

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isIosSafari() {
    var ua = window.navigator.userAgent || "";
    var isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var isWebKit = /WebKit/i.test(ua);
    var isCriOS = /CriOS/i.test(ua);
    return isiOS && isWebKit && !isCriOS;
  }

  function applyTheme(theme) {
    var nextTheme = theme === "light" || theme === "dark" ? theme : "system";
    document.documentElement.removeAttribute("data-theme");

    if (themeMeta) {
      var resolvedDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      themeMeta.setAttribute("content", resolvedDark ? "#0a0a0c" : "#f6f6f4");
    }

    window.dispatchEvent(new CustomEvent("companion:theme-changed", {
      detail: { theme: nextTheme }
    }));
  }

  function getTheme() {
    try {
      localStorage.removeItem(THEME_KEY);
    } catch (_err) {}
    return "system";
  }

  function setTheme(theme) {
    try {
      localStorage.removeItem(THEME_KEY);
    } catch (_err) {}
    applyTheme("system");
  }

  function ensureRefreshIndicator() {
    var node = document.getElementById("companionPullIndicator");
    if (node) return node;
    node = document.createElement("div");
    node.id = "companionPullIndicator";
    node.className = "pull-indicator";
    node.innerHTML = '<span class="pull-indicator-dot"></span><span class="pull-indicator-label">Relache pour actualiser</span>';
    document.body.appendChild(node);
    return node;
  }

  function setRefreshIndicator(progress, active) {
    var node = ensureRefreshIndicator();
    node.style.setProperty("--pull-progress", String(Math.max(0, Math.min(1, progress))));
    node.classList.toggle("visible", progress > 0.02 || !!active);
    node.classList.toggle("active", !!active);
  }

  function triggerRefresh() {
    if (refreshState.busy) return;
    refreshState.busy = true;
    setRefreshIndicator(1, true);

    var finished = false;
    var done = function () {
      if (finished) return;
      finished = true;
      refreshState.busy = false;
      setTimeout(function () {
        setRefreshIndicator(0, false);
      }, 220);
    };

    try {
      if (typeof window.__companionRefresh === "function") {
        Promise.resolve(window.__companionRefresh()).finally(done);
      } else {
        window.dispatchEvent(new CustomEvent("companion:refresh"));
        setTimeout(done, 550);
      }
    } catch (_err) {
      done();
    }
  }

  function installPullToRefresh() {
    ensureRefreshIndicator();

    window.addEventListener("touchstart", function (ev) {
      if (refreshState.busy) return;
      if (window.scrollY > 0) return;
      if (!ev.touches || !ev.touches.length) return;
      refreshState.startY = ev.touches[0].clientY;
      refreshState.armed = true;
      refreshState.pulling = false;
    }, { passive: true });

    window.addEventListener("touchmove", function (ev) {
      if (!refreshState.armed || refreshState.busy) return;
      if (window.scrollY > 0) {
        refreshState.armed = false;
        setRefreshIndicator(0, false);
        return;
      }
      var touch = ev.touches && ev.touches[0];
      if (!touch) return;
      var delta = touch.clientY - refreshState.startY;
      if (delta <= 0) {
        setRefreshIndicator(0, false);
        return;
      }
      refreshState.pulling = true;
      var progress = Math.min(delta / 96, 1);
      setRefreshIndicator(progress, progress >= 1);
    }, { passive: true });

    window.addEventListener("touchend", function () {
      if (!refreshState.armed) return;
      var node = document.getElementById("companionPullIndicator");
      var progress = node ? Number(node.style.getPropertyValue("--pull-progress") || 0) : 0;
      var shouldRefresh = refreshState.pulling && progress >= 1;
      refreshState.armed = false;
      refreshState.pulling = false;
      if (shouldRefresh) {
        triggerRefresh();
      } else if (!refreshState.busy) {
        setRefreshIndicator(0, false);
      }
    }, { passive: true });
  }

  function installIosBanner() {
    if (!isIosSafari() || isStandalone()) return;
    if (localStorage.getItem(IOS_BANNER_KEY) === "1") return;
    if (document.getElementById("iosInstallBanner")) return;

    var banner = document.createElement("div");
    banner.id = "iosInstallBanner";
    banner.className = "ios-install-banner fade-up";
    banner.style.cssText = [
      "margin:0 0 18px 0",
      "padding:14px 15px",
      "border-radius:18px",
      "border:1px solid rgba(15,143,102,.16)",
      "background:linear-gradient(135deg, rgba(15,143,102,.10), rgba(255,255,255,.02) 45%), rgba(255,255,255,.78)",
      "box-shadow:0 18px 34px -28px rgba(0,0,0,.26)",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:14px",
      "backdrop-filter:blur(18px) saturate(140%)"
    ].join(";");
    banner.innerHTML =
      '<div class="ios-install-copy">' +
        '<span class="ios-install-kicker">PWA iPhone</span>' +
        '<strong>Ajouter a l ecran d accueil</strong>' +
        '<span>Safari > Partager > Sur l ecran d accueil</span>' +
      '</div>' +
      '<button type="button" class="ios-install-close" aria-label="Fermer">Plus tard</button>';

    var copy = banner.querySelector(".ios-install-copy");
    if (copy) {
      copy.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;";
      var kicker = copy.querySelector(".ios-install-kicker");
      var strong = copy.querySelector("strong");
      var hint = copy.querySelector("span:last-child");
      if (kicker) kicker.style.cssText = "font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#0f8f66;font-weight:700;";
      if (strong) strong.style.cssText = "font-size:14px;line-height:1.2;color:#0a0a0c;font-weight:700;";
      if (hint) hint.style.cssText = "font-size:11px;line-height:1.45;color:#6a6a72;";
    }

    var close = banner.querySelector(".ios-install-close");
    if (close) {
      close.style.cssText = [
        "flex:0 0 auto",
        "border-radius:999px",
        "padding:9px 12px",
        "border:1px solid rgba(10,10,12,.08)",
        "background:rgba(255,255,255,.9)",
        "font-size:11px",
        "font-weight:600",
        "color:#0a0a0c",
        "box-shadow:0 10px 18px -16px rgba(0,0,0,.35)"
      ].join(";");
    }

    var wrap = document.querySelector(".wrap");
    var afterHeader = wrap ? wrap.querySelector(".page-header") : null;
    if (wrap && afterHeader && afterHeader.nextSibling) wrap.insertBefore(banner, afterHeader.nextSibling);
    else if (wrap && afterHeader) wrap.appendChild(banner);
    else if (wrap) wrap.appendChild(banner);
    else document.body.appendChild(banner);

    if (close) {
      close.addEventListener("click", function () {
        localStorage.setItem(IOS_BANNER_KEY, "1");
        banner.remove();
      });
    }
  }

  function installThemeMediaSync() {
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", function () {
        applyTheme("system");
      });
    } else if (typeof media.addListener === "function") {
      media.addListener(function () {
        applyTheme("system");
      });
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  window.CompanionUI = {
    getTheme: getTheme,
    setTheme: setTheme,
    applyTheme: applyTheme,
    triggerRefresh: triggerRefresh
  };

  applyTheme(getTheme());
  installThemeMediaSync();
  installPullToRefresh();
  installIosBanner();
  registerServiceWorker();
})();
