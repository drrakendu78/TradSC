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

fn hash_capture_page() -> String {
    r#"<!DOCTYPE html>
<html>
<head>
    <title>Connexion en cours...</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255,255,255,0.1);
            border-radius: 16px;
            backdrop-filter: blur(10px);
        }
        .spinner {
            border: 4px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top: 4px solid #7c3aed;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h1 { color: #a78bfa; margin-bottom: 10px; }
        p { color: #94a3b8; }
        .error { color: #f87171; display: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner" id="spinner"></div>
        <h1 id="title">Connexion en cours...</h1>
        <p id="message">Veuillez patienter, nous finalisons votre connexion.</p>
        <p class="error" id="error"></p>
    </div>
    <script>
        (function() {
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');
            const error = params.get('error');
            const errorDesc = params.get('error_description');
            
            console.log('Hash params:', { accessToken: accessToken ? '***' : null, refreshToken: refreshToken ? '***' : null, error });
            
            if (error) {
                document.getElementById('spinner').style.display = 'none';
                document.getElementById('title').textContent = '❌ Erreur';
                document.getElementById('title').style.color = '#f87171';
                document.getElementById('message').textContent = errorDesc || error;
                return;
            }
            
            if (accessToken) {
                // Envoyer le token au serveur local
                fetch('/auth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        access_token: accessToken,
                        refresh_token: refreshToken || ''
                    })
                })
                .then(response => response.json())
                .then(data => {
                    document.getElementById('spinner').style.display = 'none';
                    document.getElementById('title').textContent = '✅ Connexion réussie !';
                    document.getElementById('title').style.color = '#4ade80';
                    document.getElementById('message').textContent = 'Vous pouvez fermer cette fenêtre et retourner dans l\'application.';
                    // Fermer automatiquement après 2 secondes
                    setTimeout(() => window.close(), 2000);
                })
                .catch(err => {
                    console.error('Erreur:', err);
                    document.getElementById('spinner').style.display = 'none';
                    document.getElementById('title').textContent = '⚠️ Attention';
                    document.getElementById('title').style.color = '#fbbf24';
                    document.getElementById('message').textContent = 'Veuillez retourner dans l\'application.';
                });
            } else {
                // Pas de token dans le hash, vérifier les query params
                const urlParams = new URLSearchParams(window.location.search);
                const code = urlParams.get('code');
                
                if (code) {
                    document.getElementById('spinner').style.display = 'none';
                    document.getElementById('title').textContent = '✅ Connexion réussie !';
                    document.getElementById('title').style.color = '#4ade80';
                    document.getElementById('message').textContent = 'Vous pouvez fermer cette fenêtre.';
                } else {
                    document.getElementById('spinner').style.display = 'none';
                    document.getElementById('title').textContent = '⚠️ En attente...';
                    document.getElementById('title').style.color = '#fbbf24';
                    document.getElementById('message').textContent = 'Aucun token reçu. Veuillez réessayer.';
                }
            }
        })();
    </script>
</body>
</html>"#.to_string()
}

fn success_page() -> String {
    r#"<!DOCTYPE html>
<html>
<head>
    <title>Connexion réussie</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255,255,255,0.1);
            border-radius: 16px;
            backdrop-filter: blur(10px);
        }
        h1 { color: #4ade80; }
        p { color: #94a3b8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>✅ Connexion réussie !</h1>
        <p>Vous pouvez fermer cette fenêtre et retourner dans l'application.</p>
    </div>
    <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>"#.to_string()
}

fn error_page(error: &str) -> String {
    // Échapper les caractères HTML pour éviter les injections XSS
    let escaped_error = error
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;");
    
    format!(r#"<!DOCTYPE html>
<html>
<head>
    <title>Erreur de connexion</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }}
        .container {{
            text-align: center;
            padding: 2rem;
            background: rgba(255,255,255,0.1);
            border-radius: 16px;
            backdrop-filter: blur(10px);
        }}
        h1 {{ color: #f87171; }}
        p {{ color: #94a3b8; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>❌ Erreur de connexion</h1>
        <p>{}</p>
        <p>Veuillez réessayer dans l'application.</p>
    </div>
</body>
</html>"#, escaped_error)
}
