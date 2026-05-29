fn main() {
    println!("cargo:rerun-if-changed=ui");
    slint_build::compile("ui/cargo-overlay.slint").expect("compile slint UI");

    // Embarque l'icône StarTrad dans le .exe (resource ID 1) → la barre des
    // tâches / alt-tab / gestionnaire des tâches montrent l'icône StarTrad au
    // lieu d'un carré blanc générique (qui faisait "louche / virus").
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rerun-if-changed=../src-tauri/icons/icon.ico");
        let mut res = winresource::WindowsResource::new();
        res.set_icon_with_id("../src-tauri/icons/icon.ico", "1");
        if let Err(e) = res.compile() {
            println!("cargo:warning=icone StarTrad non embarquee dans le sidecar: {e}");
        }
    }
}
