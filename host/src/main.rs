use std::io::{self, BufRead, IsTerminal, Write};
use std::time::Instant;

use nu_parser::{TokenContents, lex, parse};
use nu_protocol::{
    PipelineData, ShellError, Span, UseAnsiColoring, Value,
    config::BannerKind,
    debugger::WithoutDebug,
    engine::{EngineState, Stack, StateWorkingSet},
    report_parse_error, report_shell_error,
};

fn run(engine_state: &mut EngineState, stack: &mut Stack, line: &str) {
    let (tokens, _) = lex(line.as_bytes(), 0, &[], &[], false);
    for stmt in tokens.split(|t| t.contents == TokenContents::Semicolon) {
        let (Some(first), Some(last)) = (stmt.first(), stmt.last()) else {
            continue;
        };
        let mut working_set = StateWorkingSet::new(engine_state);
        let block = parse(
            &mut working_set,
            None,
            &line.as_bytes()[first.span.start..last.span.end],
            false,
        );
        if let Some(err) = working_set.parse_errors.first() {
            report_parse_error(Some(stack), &working_set, err);
            return;
        }
        engine_state.merge_delta(working_set.render()).unwrap();
        let span = block.span.unwrap_or(Span::unknown());
        let signals = engine_state.signals().clone();
        let result = nu_engine::eval_block::<WithoutDebug>(engine_state, stack, &block, PipelineData::empty())
            .and_then(|data| {
                signals.check(&span)?;
                data.body.print_table(engine_state, stack, false, false)
            })
            .and_then(|()| signals.check(&span));
        if let Err(err) = result {
            if let ShellError::Exit { code, .. } = err {
                io::stdout().flush().unwrap();
                std::process::exit(code);
            }
            report_shell_error(Some(stack), engine_state, &err);
            return;
        }
    }
}

fn main() {
    let mut engine_state = nu_cmd_lang::create_default_context();
    engine_state = nu_command::add_shell_command_context(engine_state);
    engine_state = nu_cli::add_cli_context(engine_state);
    let mut config = engine_state.get_config().as_ref().clone();
    config.use_ansi_coloring = UseAnsiColoring::True;
    config.show_banner = BannerKind::None;
    config.hooks.display_output = None;
    engine_state.set_config(config);
    let mut stack = Stack::new();
    engine_state.add_env_var("PWD".into(), Value::string("/", Span::unknown()));
    for (k, v) in std::env::vars() {
        engine_state.add_env_var(k, Value::string(v, Span::unknown()));
    }
    run(&mut engine_state, &mut stack, r#"alias clear = ^printf "\e[H\e[2J\e[3J""#);
    let user = std::env::var("USER").unwrap_or_else(|_| "root".into());
    let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "localhost".into());
    let stdin = io::stdin();
    let mut out = io::stdout();
    if let Some(script) = std::env::args().skip_while(|a| a != "-e").nth(1) {
        run(&mut engine_state, &mut stack, &script);
    }
    if stdin.is_terminal() {
        engine_state.is_interactive = true;
        if let Err(err) = nu_cli::evaluate_repl(&mut engine_state, stack, None, None, Instant::now().into()) {
            eprintln!("{err:?}");
        }
        return;
    }
    let mut line = String::new();
    loop {
        let pwd = engine_state
            .cwd(Some(&stack))
            .map_or_else(|_| "/".into(), |p| p.to_string_lossy().into_owned());
        write!(out, "{user}@{host}:{pwd}# ").unwrap();
        out.flush().unwrap();
        line.clear();
        if stdin.lock().read_line(&mut line).unwrap() == 0 {
            break;
        }
        run(&mut engine_state, &mut stack, line.trim_end());
        out.flush().unwrap();
    }
}
