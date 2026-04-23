use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::task::JoinHandle;

const DASHBOARD_HTML: &str = include_str!("../../resources/companion/dashboard.html");
const TRADUCTION_HTML: &str = include_str!("../../resources/companion/traduction.html");
const INFOS_HTML: &str = include_str!("../../resources/companion/infos.html");
const TOOLS_HTML: &str = include_str!("../../resources/companion/outils.html");
const APP_CSS: &str = include_str!("../../resources/companion/app.css");
const COMPANION_JS: &str = include_str!("../../resources/companion/companion.js");
const SERVICE_WORKER_JS: &str = include_str!("../../resources/companion/sw.js");
const LOGO_PNG: &[u8] = include_bytes!("../../resources/companion/logo.png");

static NEXT_CLIENT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct CompanionState {
    inner: Arc<CompanionInner>,
}

struct CompanionInner {
    app_handle: AppHandle,
    token: Mutex<String>,
    settings: Mutex<CompanionSettings>,
    clients: Mutex<HashMap<u64, UnboundedSender<Message>>>,
    server_handle: Mutex<Option<JoinHandle<()>>>,
    bound_addr: Mutex<Option<SocketAddr>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CompanionSettings {
    persistent_token: bool,
    saved_token: Option<String>,
}

impl CompanionState {
    pub fn new(app_handle: AppHandle) -> Self {
        let settings = load_companion_settings().unwrap_or_default();
        let token = settings
            .saved_token
            .clone()
            .filter(|value| settings.persistent_token && !value.trim().is_empty())
            .unwrap_or_else(generate_token);

        Self {
            inner: Arc::new(CompanionInner {
                app_handle,
                token: Mutex::new(token),
                settings: Mutex::new(settings),
                clients: Mutex::new(HashMap::new()),
                server_handle: Mutex::new(None),
                bound_addr: Mutex::new(None),
            }),
        }
    }

    pub fn token(&self) -> String {
        self.inner.token.lock().unwrap().clone()
    }

    fn persistent_token_enabled(&self) -> bool {
        self.inner.settings.lock().unwrap().persistent_token
    }

    fn set_persistent_token_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut settings = self.inner.settings.lock().unwrap();
        settings.persistent_token = enabled;

        if enabled {
            settings.saved_token = Some(self.token());
        } else {
            let fresh_token = generate_token();
            *self.inner.token.lock().unwrap() = fresh_token;
            settings.saved_token = None;
        }

        save_companion_settings(&settings)
    }

    fn broadcast(&self, payload: &str) {
        let msg = Message::Text(payload.to_string());
        let clients = self.inner.clients.lock().unwrap();
        for tx in clients.values() {
            let _ = tx.send(msg.clone());
        }
    }

    fn send_to(&self, client_id: u64, payload: &str) -> bool {
        let msg = Message::Text(payload.to_string());
        let clients = self.inner.clients.lock().unwrap();
        if let Some(tx) = clients.get(&client_id) {
            return tx.send(msg).is_ok();
        }
        false
    }

    fn register(&self, client_id: u64, tx: UnboundedSender<Message>) {
        self.inner.clients.lock().unwrap().insert(client_id, tx);
    }

    fn unregister(&self, client_id: u64) {
        self.inner.clients.lock().unwrap().remove(&client_id);
    }
}

fn generate_token() -> String {
    // Token pseudo-aléatoire sans dépendance externe :
    // nanos + pid + ptr addr, hexa URL-safe.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let boxed = Box::new(0u8);
    let ptr = (&*boxed as *const u8) as usize as u128;
    let mixed = nanos.wrapping_mul(0x9E3779B97F4A7C15_u128) ^ pid.wrapping_shl(17) ^ ptr;
    format!("{:032x}", mixed)
}

fn companion_settings_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("TradSC").join("companion_settings.json"))
}

fn load_companion_settings() -> Result<CompanionSettings, String> {
    let path = companion_settings_path().ok_or_else(|| "Dossier appdata introuvable".to_string())?;
    if !path.exists() {
        return Ok(CompanionSettings::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Lecture config companion: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Config companion invalide: {}", e))
}

fn save_companion_settings(settings: &CompanionSettings) -> Result<(), String> {
    let path = companion_settings_path().ok_or_else(|| "Dossier appdata introuvable".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Creation config companion: {}", e))?;
    }

    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Serialisation config companion: {}", e))?;
    fs::write(path, content).map_err(|e| format!("Sauvegarde config companion: {}", e))
}

fn detect_lan_ip() -> Option<Ipv4Addr> {
    // Astuce UDP connect : ne transmet aucun paquet, résout juste la route locale.
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    pub url: Option<String>,
    pub ip: Option<String>,
    pub port: u16,
    pub token: String,
    pub running: bool,
    pub clients: usize,
    pub persistent_token: bool,
}

async fn serve_dashboard() -> Html<&'static str> {
    Html(DASHBOARD_HTML)
}

async fn serve_traduction() -> Html<&'static str> {
    Html(TRADUCTION_HTML)
}

async fn serve_infos() -> Html<&'static str> {
    Html(INFOS_HTML)
}

async fn serve_tools() -> Html<&'static str> {
    Html(TOOLS_HTML)
}

async fn serve_logo() -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        LOGO_PNG,
    )
        .into_response()
}

async fn serve_css() -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/css; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        APP_CSS,
    )
        .into_response()
}

async fn serve_companion_js() -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/javascript; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        COMPANION_JS,
    )
        .into_response()
}

async fn serve_service_worker() -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/javascript; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        SERVICE_WORKER_JS,
    )
        .into_response()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsQuery>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<CompanionState>,
) -> Response {
    let expected = state.token();
    let provided = params.token.unwrap_or_default();
    if provided != expected {
        return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state, addr))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomingPayload {
    client_id: u64,
    payload: String,
    peer: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientLifecyclePayload {
    client_id: u64,
    peer: String,
    total_clients: usize,
}

async fn handle_socket(socket: WebSocket, state: CompanionState, peer: SocketAddr) {
    let client_id = NEXT_CLIENT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = unbounded_channel::<Message>();
    state.register(client_id, tx.clone());

    let peer_str = peer.to_string();
    let total = state.inner.clients.lock().unwrap().len();
    let _ = state.inner.app_handle.emit(
        "companion:client_connected",
        ClientLifecyclePayload {
            client_id,
            peer: peer_str.clone(),
            total_clients: total,
        },
    );

    let (mut ws_tx, mut ws_rx) = socket.split();
    let app_handle = state.inner.app_handle.clone();

    // Accusé de réception initial — le client recevra ses premiers states ensuite
    // via la réponse React au state.query.
    let _ = tx.send(Message::Text(
        serde_json::json!({ "type": "ready", "clientId": client_id }).to_string(),
    ));

    // Task : forward messages depuis le channel vers la WS
    let mut out_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Task : lire la WS, router vers Tauri
    let state_for_in = state.clone();
    let peer_for_in = peer_str.clone();
    let mut in_task = tokio::spawn(async move {
        while let Some(res) = ws_rx.next().await {
            let msg = match res {
                Ok(m) => m,
                Err(_) => break,
            };
            match msg {
                Message::Text(text) => {
                    let _ = app_handle.emit(
                        "companion:incoming",
                        IncomingPayload {
                            client_id,
                            payload: text,
                            peer: peer_for_in.clone(),
                        },
                    );
                }
                Message::Ping(data) => {
                    let _ = state_for_in
                        .inner
                        .clients
                        .lock()
                        .unwrap()
                        .get(&client_id)
                        .and_then(|tx| tx.send(Message::Pong(data)).ok());
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut out_task => { in_task.abort(); }
        _ = &mut in_task => { out_task.abort(); }
    }

    state.unregister(client_id);
    let total = state.inner.clients.lock().unwrap().len();
    let _ = state.inner.app_handle.emit(
        "companion:client_disconnected",
        ClientLifecyclePayload {
            client_id,
            peer: peer_str,
            total_clients: total,
        },
    );
}

pub async fn start_server(state: CompanionState, port: u16) -> Result<SocketAddr, String> {
    // Stop l'ancien serveur s'il existe (rebind port).
    stop_server(&state);

    let app = Router::new()
        .route("/", get(serve_dashboard))
        .route("/traduction", get(serve_traduction))
        .route("/infos", get(serve_infos))
        .route("/outils", get(serve_tools))
        .route("/logo.png", get(serve_logo))
        .route("/favicon.ico", get(serve_logo))
        .route("/app.css", get(serve_css))
        .route("/companion.js", get(serve_companion_js))
        .route("/sw.js", get(serve_service_worker))
        .route(
            "/manifest.json",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "application/json")],
                    r##"{"name":"StarTrad FR Companion","short_name":"StarTrad","display":"standalone","start_url":"/","scope":"/","background_color":"#05070B","theme_color":"#05070B","icons":[{"src":"/logo.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"/logo.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}"##,
                )
            }),
        )
        .route("/ws", get(ws_handler))
        .with_state(state.clone());

    let addr: SocketAddr = format!("0.0.0.0:{}", port)
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Bind {}: {}", addr, e))?;
    let bound = listener
        .local_addr()
        .map_err(|e| e.to_string())?;

    *state.inner.bound_addr.lock().unwrap() = Some(bound);

    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await;
    });
    *state.inner.server_handle.lock().unwrap() = Some(handle);

    Ok(bound)
}

pub fn stop_server(state: &CompanionState) {
    if let Some(handle) = state.inner.server_handle.lock().unwrap().take() {
        handle.abort();
    }
    *state.inner.bound_addr.lock().unwrap() = None;
    state.inner.clients.lock().unwrap().clear();
}

pub fn current_info(state: &CompanionState) -> CompanionInfo {
    let bound = *state.inner.bound_addr.lock().unwrap();
    let clients = state.inner.clients.lock().unwrap().len();
    let (ip_opt, port) = match bound {
        Some(a) => (detect_lan_ip().map(|v| v.to_string()), a.port()),
        None => (None, 0),
    };
    let url = match (&ip_opt, port) {
        (Some(ip), p) if p != 0 => Some(format!(
            "http://{}:{}/?token={}",
            ip,
            p,
            state.token()
        )),
        _ => None,
    };
    CompanionInfo {
        url,
        ip: ip_opt,
        port,
        token: state.token(),
        running: bound.is_some(),
        clients,
        persistent_token: state.persistent_token_enabled(),
    }
}

// ─── Commandes Tauri ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_companion_server(
    state: tauri::State<'_, CompanionState>,
    port: Option<u16>,
) -> Result<CompanionInfo, String> {
    let port = port.unwrap_or(47823);
    start_server(state.inner().clone(), port).await?;
    Ok(current_info(state.inner()))
}

#[tauri::command]
pub fn stop_companion_server(state: tauri::State<'_, CompanionState>) -> Result<(), String> {
    stop_server(state.inner());
    Ok(())
}

#[tauri::command]
pub fn get_companion_info(state: tauri::State<'_, CompanionState>) -> CompanionInfo {
    current_info(state.inner())
}

#[tauri::command]
pub fn set_companion_persistent_token(
    state: tauri::State<'_, CompanionState>,
    enabled: bool,
) -> Result<CompanionInfo, String> {
    state.set_persistent_token_enabled(enabled)?;
    Ok(current_info(state.inner()))
}

#[tauri::command]
pub fn companion_broadcast(
    state: tauri::State<'_, CompanionState>,
    message: String,
) -> Result<usize, String> {
    state.broadcast(&message);
    Ok(state.inner.clients.lock().unwrap().len())
}

#[tauri::command]
pub fn companion_send(
    state: tauri::State<'_, CompanionState>,
    client_id: u64,
    message: String,
) -> Result<bool, String> {
    Ok(state.send_to(client_id, &message))
}
