use axum::{
    extract::Query,
    response::Html,
    routing::{get, post},
    Json, Router,
};
use axum::serve;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tauri::Emitter;

#[derive(Deserialize)]
struct CallbackParams {
    code: Option<String>,
    error: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct TokenPayload {
    access_token: String,
    refresh_token: Option<String>,
}

pub async fn start_oauth_callback_server(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let (tx, rx) = oneshot::channel::<String>();
    let tx = Arc::new(tokio::sync::Mutex::new(Some(tx)));

    let app = Router::new()
        // Route principale qui sert une page HTML pour capturer le hash
        .route(
            "/auth/callback",
            get({
                let tx = tx.clone();
                let app_handle = app_handle.clone();
                move |query: Query<CallbackParams>| {
                    let tx = tx.clone();
                    let app_handle = app_handle.clone();
                    async move {
                        // Logs minimaux pour la sécurité (pas de données sensibles)
                        #[cfg(debug_assertions)]
                        eprintln!("[OAuth Callback] Requête reçue sur /auth/callback");
                        
                        // Si on a déjà les tokens dans les query params (depuis /auth/token)
                        if let Some(access_token) = &query.access_token {
                            #[cfg(debug_assertions)]
                            eprintln!("[OAuth Callback] ✅ Access token reçu");
                            let token_data = format!("access_token={}&refresh_token={}", 
                                access_token, 
                                query.refresh_token.as_deref().unwrap_or("")
                            );
                            let _ = app_handle.emit("oauth-callback", token_data.clone());
                            
                            let mut sender = tx.lock().await;
                            if let Some(s) = sender.take() {
                                let _ = s.send(token_data);
                            }
                            
                            return Html(success_page());
                        }
                        
                        // Si on a un code (flow authorization code)
                        if let Some(code) = &query.code {
                            #[cfg(debug_assertions)]
                            eprintln!("[OAuth Callback] ✅ Code reçu");
                            let _ = app_handle.emit("oauth-callback", format!("code={}", code));
                            
                            let mut sender = tx.lock().await;
                            if let Some(s) = sender.take() {
                                let _ = s.send(format!("code={}", code));
                            }
                            
                            return Html(success_page());
                        }
                        
                        // Si on a une erreur
                        if let Some(error) = &query.error {
                            #[cfg(debug_assertions)]
                            eprintln!("[OAuth Callback] ❌ Erreur OAuth");
                            let _ = app_handle.emit("oauth-error", error.clone());
                            return Html(error_page(error));
                        }
                        
                        // Sinon, servir une page HTML qui capture le hash
                        // Le hash (#access_token=...) n'est pas envoyé au serveur
                        // Donc on sert une page JS qui le lit et le renvoie
                        Html(hash_capture_page())
                    }
                }
            }),
        )
        // Route POST pour recevoir les tokens depuis le JavaScript
        .route(
            "/auth/token",
            post({
                let tx = tx.clone();
                let app_handle = app_handle.clone();
                move |Json(payload): Json<TokenPayload>| {
                    let tx = tx.clone();
                    let app_handle = app_handle.clone();
                    async move {
                        #[cfg(debug_assertions)]
                        eprintln!("[OAuth Callback] ✅ Token reçu via POST");
                        let token_data = format!("access_token={}&refresh_token={}", 
                            payload.access_token, 
                            payload.refresh_token.as_deref().unwrap_or("")
                        );
                        let _ = app_handle.emit("oauth-callback", token_data.clone());
                        
                        let mut sender = tx.lock().await;
                        if let Some(s) = sender.take() {
                            let _ = s.send(token_data);
                        }
                        
                        Json(serde_json::json!({"status": "ok"}))
                    }
                }
            }),
        )
        .route(
            "/auth/success",
            get(|| async { Html(success_page()) }),
        )
        .route(
            "/auth/error",
            get(|| async { Html(error_page("Erreur inconnue")) }),
        )
        .route(
            "/favicon.ico",
            get(|| async { axum::http::StatusCode::NO_CONTENT }),
        );

    let listener = TcpListener::bind("127.0.0.1:1421")
        .await
        .map_err(|e| format!("Impossible de démarrer le serveur: {}", e))?;

    #[cfg(debug_assertions)]
    eprintln!("[OAuth Callback] Serveur démarré sur http://127.0.0.1:1421");

    // Démarrer le serveur dans un task séparé
    let server_handle = tokio::spawn(async move {
        let _ = serve(listener, app).await;
    });

    // Attendre le code (avec timeout)
    let result = tokio::select! {
        result = rx => {
            match result {
                Ok(data) => Ok(data),
                Err(_) => Err("Le serveur a été fermé".to_string()),
            }
        }
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(180)) => {
            Err("Timeout: le token n'a pas été reçu dans les 3 minutes".to_string())
        }
    };

    // Arrêter le serveur après avoir reçu le code ou timeout
    server_handle.abort();

    result
}

fn get_base_styles() -> &'static str {
    r#"* { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --bg-primary: #0a0a0f; --text-primary: #ffffff; --text-secondary: #94a3b8; --accent: #06b6d4; --accent-light: #22d3ee; --accent-dark: #0891b2; --success: #4ade80; --error: #f87171; --warning: #fbbf24; }
    body { min-height: 100vh; background: var(--bg-primary); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--text-primary); display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
    .animated-bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; z-index: 0; pointer-events: none; }
    .gradient-orb { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.6; animation: float 20s ease-in-out infinite; }
    .orb-1 { width: 500px; height: 500px; background: radial-gradient(circle, rgba(6, 182, 212, 0.4) 0%, transparent 70%); top: -150px; left: -100px; }
    .orb-2 { width: 400px; height: 400px; background: radial-gradient(circle, rgba(6, 78, 140, 0.3) 0%, transparent 70%); bottom: -100px; right: -100px; animation-delay: -10s; }
    .orb-3 { width: 300px; height: 300px; background: radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, transparent 70%); top: 50%; left: 50%; transform: translate(-50%, -50%); animation-delay: -5s; }
    @keyframes float { 0%, 100% { transform: translate(0, 0) scale(1); } 25% { transform: translate(30px, -30px) scale(1.05); } 50% { transform: translate(-20px, 20px) scale(0.95); } 75% { transform: translate(20px, 30px) scale(1.02); } }
    .stars-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
    .star { position: absolute; border-radius: 50%; pointer-events: none; }
    .shooting-stars { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; }
    .shooting-star { position: absolute; width: 100px; height: 2px; background: linear-gradient(90deg, transparent, var(--accent-light)); border-radius: 50%; opacity: 0; transform: rotate(-45deg); animation: shoot 3s ease-in-out infinite; }
    .shooting-star::before { content: ''; position: absolute; width: 6px; height: 6px; background: #fff; border-radius: 50%; right: 0; top: 50%; transform: translateY(-50%); box-shadow: 0 0 6px 2px #fff, 0 0 10px var(--accent-light), 0 0 20px var(--accent-light), 0 0 30px var(--accent); }
    .shooting-star:nth-child(1) { top: 10%; left: 20%; animation-delay: 0s; }
    .shooting-star:nth-child(2) { top: 40%; left: 70%; animation-delay: 4s; }
    .shooting-star:nth-child(3) { top: 60%; left: 30%; animation-delay: 8s; }
    @keyframes shoot { 0% { opacity: 0; transform: rotate(-45deg) translateX(0); } 5% { opacity: 1; } 20% { opacity: 1; } 100% { opacity: 0; transform: rotate(-45deg) translateX(500px); } }
    .container { text-align: center; padding: 40px; position: relative; z-index: 1; max-width: 600px; }
    .logo { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 48px; }
    .logo-text { font-size: 28px; font-weight: 700; }
    .logo-star { color: var(--accent); }
    .logo-trad { color: var(--text-primary); }
    .icon-status { width: 140px; height: 140px; margin: 0 auto 40px; background: rgba(6, 182, 212, 0.08); border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid rgba(6, 182, 212, 0.2); animation: pulse 3s ease-in-out infinite; box-shadow: 0 0 60px rgba(6, 182, 212, 0.15); }
    .icon-status.success { background: rgba(74, 222, 128, 0.08); border-color: rgba(74, 222, 128, 0.4); box-shadow: 0 0 60px rgba(74, 222, 128, 0.15); }
    .icon-status.success svg { color: var(--success); }
    .icon-status.error { background: rgba(248, 113, 113, 0.08); border-color: rgba(248, 113, 113, 0.4); box-shadow: 0 0 60px rgba(248, 113, 113, 0.15); }
    .icon-status.error svg { color: var(--error); }
    .icon-status.warning { background: rgba(251, 191, 36, 0.08); border-color: rgba(251, 191, 36, 0.4); box-shadow: 0 0 60px rgba(251, 191, 36, 0.15); }
    .icon-status.warning svg { color: var(--warning); }
    @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
    .icon-status svg { width: 70px; height: 70px; color: var(--accent); }
    .icon-loader { animation: spin 1s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    h1 { font-size: 40px; font-weight: 700; margin-bottom: 16px; }
    h1 span { color: var(--accent); }
    h1.success span { color: var(--success); }
    h1.error span { color: var(--error); }
    p { font-size: 18px; color: var(--text-secondary); line-height: 1.7; }
    .footer { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); font-size: 14px; color: #475569; }"#
}

fn get_animated_bg() -> &'static str {
    r#"<div class="animated-bg">
    <div class="gradient-orb orb-1"></div>
    <div class="gradient-orb orb-2"></div>
    <div class="gradient-orb orb-3"></div>
    <div class="stars-container" id="starsContainer"></div>
    <div class="shooting-stars">
      <div class="shooting-star"></div>
      <div class="shooting-star"></div>
      <div class="shooting-star"></div>
    </div>
  </div>"#
}

fn get_stars_script() -> &'static str {
    r#"<script>
    (function() {
      var c = document.getElementById('starsContainer');
      for (var i = 0; i < 50; i++) {
        var s = document.createElement('div');
        s.className = 'star';
        var sz = Math.random() * 2 + 1;
        var cy = Math.random() > 0.7;
        s.style.cssText = 'width:'+sz+'px;height:'+sz+'px;left:'+Math.random()*100+'%;top:'+Math.random()*100+'%;background:'+(cy?'rgba(6,182,212,0.9)':'rgba(255,255,255,0.8)')+';box-shadow:0 0 '+(sz*2)+'px '+(cy?'rgba(6,182,212,0.5)':'rgba(255,255,255,0.3)')+';animation:twinkle '+(2+Math.random()*3)+'s ease-in-out infinite alternate;animation-delay:'+Math.random()*2+'s;';
        c.appendChild(s);
      }
      var st = document.createElement('style');
      st.textContent = '@keyframes twinkle { 0% { opacity: 0.3; } 100% { opacity: 1; } }';
      document.head.appendChild(st);
    })();
  </script>"#
}

fn hash_capture_page() -> String {
    format!(r#"<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connexion - StarTrad FR</title>
  <style>{}</style>
</head>
<body>
  {}
  <div class="container">
    <div class="logo"><span class="logo-text"><span class="logo-star">Star</span><span class="logo-trad">Trad</span></span></div>
    <div class="icon-status" id="iconStatus">
      <svg id="iconLoader" class="icon-loader" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      <svg id="iconSuccess" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      <svg id="iconError" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <svg id="iconWarning" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>
    <h1 id="title">Connexion <span>en cours</span></h1>
    <p id="message">Veuillez patienter, nous finalisons votre connexion...</p>
  </div>
  <div class="footer">StarTrad FR - Justitia Gold Guard</div>
  {}
  <script>
    (function() {{
      var hash = window.location.hash.substring(1);
      var params = new URLSearchParams(hash);
      var accessToken = params.get('access_token');
      var refreshToken = params.get('refresh_token');
      var error = params.get('error');
      var errorDesc = params.get('error_description');

      function showSuccess() {{
        document.getElementById('iconLoader').style.display = 'none';
        document.getElementById('iconSuccess').style.display = 'block';
        document.getElementById('iconStatus').classList.add('success');
        document.getElementById('title').className = 'success';
        document.getElementById('title').innerHTML = 'Connexion <span>réussie</span>';
        document.getElementById('message').textContent = 'Vous pouvez fermer cette fenêtre et retourner dans l\'application.';
        // Déclencher le deep link pour ouvrir l'application
        var params = window.location.search || ('?' + window.location.hash.substring(1));
        if (params && params !== '?') {{
          var deepLinkUrl = 'startradfr://auth/callback' + params;
          setTimeout(function() {{ window.location.href = deepLinkUrl; }}, 500);
        }}
        setTimeout(function() {{ window.close(); }}, 3000);
      }}
      function showError(msg) {{
        document.getElementById('iconLoader').style.display = 'none';
        document.getElementById('iconError').style.display = 'block';
        document.getElementById('iconStatus').classList.add('error');
        document.getElementById('title').className = 'error';
        document.getElementById('title').innerHTML = 'Connexion <span>échouée</span>';
        document.getElementById('message').textContent = msg || 'Une erreur est survenue.';
      }}
      function showWarning(msg) {{
        document.getElementById('iconLoader').style.display = 'none';
        document.getElementById('iconWarning').style.display = 'block';
        document.getElementById('iconStatus').classList.add('warning');
        document.getElementById('title').innerHTML = 'Attention <span>requise</span>';
        document.getElementById('message').textContent = msg;
      }}

      if (error) {{ showError(errorDesc || error); return; }}
      if (accessToken) {{
        fetch('/auth/token', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ access_token: accessToken, refresh_token: refreshToken || '' }}) }})
          .then(function(r) {{ return r.json(); }}).then(function() {{ showSuccess(); }}).catch(function() {{ showWarning('Veuillez retourner dans l\'application.'); }});
      }} else {{
        var code = new URLSearchParams(window.location.search).get('code');
        if (code) {{ showSuccess(); }} else {{ showWarning('Aucun token reçu. Veuillez réessayer.'); }}
      }}
    }})();
  </script>
</body>
</html>"#, get_base_styles(), get_animated_bg(), get_stars_script())
}

fn success_page() -> String {
    format!(r#"<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connexion réussie - StarTrad FR</title>
  <style>{}</style>
</head>
<body>
  {}
  <div class="container">
    <div class="logo"><span class="logo-text"><span class="logo-star">Star</span><span class="logo-trad">Trad</span></span></div>
    <div class="icon-status success">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <h1 class="success">Connexion <span>réussie</span></h1>
    <p>Vous pouvez fermer cette fenêtre et retourner dans l'application.</p>
  </div>
  <div class="footer">StarTrad FR - Justitia Gold Guard</div>
  {}
  <script>
    (function() {{
      // Déclencher le deep link pour ouvrir l'application
      var params = window.location.search;
      if (params) {{
        var deepLinkUrl = 'startradfr://auth/callback' + params;
        // Attendre un peu avant de déclencher le deep link
        setTimeout(function() {{
          window.location.href = deepLinkUrl;
        }}, 500);
      }}
      // Fermer la fenêtre après un délai
      setTimeout(function() {{ window.close(); }}, 3000);
    }})();
  </script>
</body>
</html>"#, get_base_styles(), get_animated_bg(), get_stars_script())
}

fn error_page(error: &str) -> String {
    let escaped_error = error
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;");

    format!(r#"<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Erreur - StarTrad FR</title>
  <style>{}</style>
</head>
<body>
  {}
  <div class="container">
    <div class="logo"><span class="logo-text"><span class="logo-star">Star</span><span class="logo-trad">Trad</span></span></div>
    <div class="icon-status error">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    </div>
    <h1 class="error">Connexion <span>échouée</span></h1>
    <p>{}</p>
    <p>Veuillez réessayer dans l'application.</p>
  </div>
  <div class="footer">StarTrad FR - Justitia Gold Guard</div>
  {}
</body>
</html>"#, get_base_styles(), get_animated_bg(), escaped_error, get_stars_script())
}
