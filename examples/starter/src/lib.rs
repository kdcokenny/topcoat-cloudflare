//! The official Topcoat coffee-shop demo, adapted for Cloudflare Workers.

mod app;
mod components;
mod customer;
mod models;

topcoat_cloudflare::entrypoint!(app::router);
