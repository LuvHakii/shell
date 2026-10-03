use nu_engine::{command_prelude::*, env_to_strings};
use nu_path::dots::expand_ndots_safe;
use nu_path::expand_tilde;
use nu_protocol::shell_error::{generic::GenericError, io::IoError};
use nu_protocol::{ByteStream, ByteStreamType, NuGlob, OutDest, Signals, UseAnsiColoring};
use pathdiff::diff_paths;
use std::{
    borrow::Cow,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

#[path = "system/which_.rs"]
mod which_;
pub use which_::Which;

#[link(wasm_import_module = "tty")]
unsafe extern "C" {
    fn spawn(req: *const u8, len: usize) -> i32;
    fn spawn_read(buf: *mut u8);
}

#[derive(Clone)]
pub struct External;

impl Command for External {
    fn name(&self) -> &str {
        "run-external"
    }

    fn description(&self) -> &str {
        "Runs external command."
    }

    fn signature(&self) -> nu_protocol::Signature {
        Signature::build(self.name())
            .input_output_types(vec![(Type::Any, Type::Any)])
            .rest(
                "command",
                SyntaxShape::OneOf(vec![SyntaxShape::GlobPattern, SyntaxShape::Any]),
                "External command to run, with arguments.",
            )
            .category(Category::System)
    }

    fn run(
        &self,
        engine_state: &EngineState,
        stack: &mut Stack,
        call: &Call,
        input: PipelineData,
    ) -> Result<PipelineData, ShellError> {
        let cwd = engine_state.cwd(Some(stack))?;
        let rest = call.rest::<Value>(engine_state, stack, 0)?;
        let Some((name, call_args)) = rest.split_first() else {
            return Err(ShellError::MissingParameter {
                param_name: "no command given".into(),
                span: call.head,
            });
        };
        let name_str: Cow<str> = match name {
            Value::Glob { val, .. } | Value::String { val, .. } => Cow::Borrowed(val),
            _ => Cow::Owned(name.clone().coerce_into_string()?),
        };

        let mut argv = vec![name_str.to_string()];
        for arg in call_args {
            let span = arg.span();
            match arg {
                Value::Glob { val, no_expand, .. } if !*no_expand => argv.extend(expand_glob(
                    val,
                    cwd.as_std_path(),
                    span,
                    engine_state.signals().clone(),
                )?),
                Value::List { .. } => {
                    return Err(ShellError::CannotPassListToExternal {
                        arg: String::from_utf8_lossy(engine_state.get_span_contents(span))
                            .into_owned(),
                        span,
                    });
                }
                Value::Glob { val, .. } => argv.push(val.clone()),
                other => argv.push(other.clone().coerce_into_string()?),
            }
        }

        let envs = env_to_strings(engine_state, stack)?;
        let stdin = pipeline_bytes(engine_state, stack, input)?;

        let mut req = Vec::new();
        put(&mut req, cwd.to_string_lossy().as_bytes());
        put_len(&mut req, argv.len());
        for arg in &argv {
            put(&mut req, arg.as_bytes());
        }
        put_len(&mut req, envs.len());
        for (k, v) in &envs {
            put(&mut req, k.as_bytes());
            put(&mut req, v.as_bytes());
        }
        put(&mut req, &stdin);

        let n = unsafe { spawn(req.as_ptr(), req.len()) };
        if n < 0 {
            return Err(ShellError::ExternalCommand {
                label: format!("Command `{name_str}` not found"),
                help: String::new(),
                span: call.head,
            });
        }
        let mut res = vec![0u8; n as usize];
        unsafe { spawn_read(res.as_mut_ptr()) };

        let code = i32::from_le_bytes(res[0..4].try_into().unwrap());
        let out_len = u32::from_le_bytes(res[4..8].try_into().unwrap()) as usize;
        let err_len = u32::from_le_bytes(res[8..12].try_into().unwrap()) as usize;
        let out = res[12..12 + out_len].to_vec();
        let err = &res[12 + out_len..12 + out_len + err_len];
        stack.set_last_exit_code(code, call.head);
        if matches!(stack.stderr(), OutDest::PipeSeparate) {
            let record = record! {
                "stdout" => Value::string(String::from_utf8_lossy(&out), call.head),
                "stderr" => Value::string(String::from_utf8_lossy(err), call.head),
                "exit_code" => Value::int(code.into(), call.head),
            };
            return Ok(Value::record(record, call.head).into_pipeline_data());
        }
        if !err.is_empty() {
            let _ = std::io::stderr().write_all(err);
        }

        Ok(PipelineData::byte_stream(
            ByteStream::read(
                Cursor::new(out),
                call.head,
                engine_state.signals().clone(),
                ByteStreamType::Unknown,
            ),
            None,
        ))
    }
}

#[derive(Clone)]
pub struct Complete;

impl Command for Complete {
    fn name(&self) -> &str {
        "complete"
    }

    fn signature(&self) -> Signature {
        Signature::build("complete")
            .category(Category::System)
            .input_output_types(vec![(Type::Any, Type::record())])
    }

    fn description(&self) -> &str {
        "Capture the outputs and exit code from an external piped in command in a nushell table."
    }

    fn run(
        &self,
        _engine_state: &EngineState,
        _stack: &mut Stack,
        call: &Call,
        input: PipelineData,
    ) -> Result<PipelineData, ShellError> {
        match input {
            PipelineData::Value(record @ Value::Record { .. }, _) => Ok(record.into_pipeline_data()),
            _ => Err(ShellError::Generic(GenericError::new(
                "Complete only works with external commands",
                "not an external command",
                call.head,
            ))),
        }
    }

    fn pipe_redirection(&self) -> (Option<OutDest>, Option<OutDest>) {
        (Some(OutDest::PipeSeparate), Some(OutDest::PipeSeparate))
    }
}

#[derive(Clone)]
pub struct Input;

impl Command for Input {
    fn name(&self) -> &str {
        "input"
    }

    fn signature(&self) -> Signature {
        Signature::build("input")
            .input_output_types(vec![(Type::Nothing, Type::String)])
            .optional("prompt", SyntaxShape::String, "Prompt to show the user.")
            .category(Category::Platform)
    }

    fn description(&self) -> &str {
        "Get input from the user."
    }

    fn run(
        &self,
        engine_state: &EngineState,
        stack: &mut Stack,
        call: &Call,
        _input: PipelineData,
    ) -> Result<PipelineData, ShellError> {
        if let Some(prompt) = call.opt::<String>(engine_state, stack, 0)? {
            print!("{prompt}");
            let _ = std::io::stdout().flush();
        }
        let mut line = String::new();
        std::io::stdin()
            .read_line(&mut line)
            .map_err(|err| IoError::new(err, call.head, None))?;
        let line = line.trim_end_matches(['\n', '\r']);
        Ok(Value::string(line, call.head).into_pipeline_data())
    }
}

fn put_len(buf: &mut Vec<u8>, n: usize) {
    buf.extend_from_slice(&(n as u32).to_le_bytes());
}

fn put(buf: &mut Vec<u8>, bytes: &[u8]) {
    put_len(buf, bytes.len());
    buf.extend_from_slice(bytes);
}

fn pipeline_bytes(
    engine_state: &EngineState,
    stack: &mut Stack,
    data: PipelineData,
) -> Result<Vec<u8>, ShellError> {
    match data {
        PipelineData::Empty => Ok(Vec::new()),
        PipelineData::ByteStream(stream, ..) => {
            let mut out = Vec::new();
            stream.write_to(&mut out)?;
            Ok(out)
        }
        PipelineData::Value(Value::Binary { val, .. }, ..) => Ok(val.into_owned()),
        data => {
            let mut engine_state = engine_state.clone();
            let mut stack = stack.clone();
            stack.start_collect_value();
            let mut config = engine_state.get_config().as_ref().clone();
            config.use_ansi_coloring = UseAnsiColoring::False;
            engine_state.set_config(config);
            let output =
                crate::Table.run(&engine_state, &mut stack, &Call::new(Span::unknown()), data)?;
            let mut out = Vec::new();
            for value in output {
                out.extend(value.coerce_into_binary()?);
            }
            Ok(out)
        }
    }
}

fn expand_glob(
    arg: &str,
    cwd: &Path,
    span: Span,
    signals: Signals,
) -> Result<Vec<String>, ShellError> {
    if !nu_glob::is_glob_with_backend(arg) {
        return Ok(vec![
            expand_ndots_safe(expand_tilde(arg))
                .to_string_lossy()
                .into_owned(),
        ]);
    }

    let glob = NuGlob::Expand(arg.to_owned()).into_spanned(span);
    let Ok((prefix, matches)) = nu_engine::glob_from(&glob, cwd, span, None, signals.clone())
    else {
        return Ok(vec![arg.to_owned()]);
    };
    let mut result = Vec::new();
    for m in matches {
        signals.check(&span)?;
        result.push(match m {
            Ok(path) => relative_to_cwd(path, prefix.as_ref(), cwd)
                .to_string_lossy()
                .into_owned(),
            Err(_) => arg.to_owned(),
        });
    }
    if result.is_empty() {
        result.push(arg.to_owned());
    }
    Ok(result)
}

fn relative_to_cwd(path: PathBuf, prefix: Option<&PathBuf>, cwd: &Path) -> PathBuf {
    let Some(prefix) = prefix else { return path };
    let Ok(remainder) = path.strip_prefix(prefix) else {
        return path;
    };
    diff_paths(prefix, cwd)
        .unwrap_or_else(|| prefix.to_path_buf())
        .join(remainder)
}
