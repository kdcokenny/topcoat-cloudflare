fn main() {
    println!("cargo:rerun-if-changed=styles.css");
    println!("cargo:rerun-if-changed=src");
    topcoat::tailwind::BuildConfig::new()
        .executable("tailwindcss")
        .input("styles.css")
        .render()
        .expect("compile the coffee-shop stylesheet");
}
