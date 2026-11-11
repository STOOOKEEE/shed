# SHED contract

NEP-141 token + NEP-171 skins in one contract. Rules and JSON API: [../docs/design.md](../docs/design.md).

```bash
cargo test                                  # unit tests + sandbox end-to-end test
cargo near build non-reproducible-wasm      # target/near/shed.wasm
cargo run --example local_demo              # local sandbox with a played scenario, for the web app
cargo run --example simulate                # 60-cycle supply simulation → ../docs/simulation.svg
cargo run --example gallery                 # sample renders → ../docs/gallery/
```
