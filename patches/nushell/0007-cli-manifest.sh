# nu-cli's nu-command, nu-engine and nu-protocol deps without the "os" feature, as `x.workspace = true` (ast-grep has no TOML grammar).
cargo remove -q -p nu-cli nu-command nu-engine nu-protocol
cargo add -q -p nu-cli nu-command nu-engine nu-protocol
