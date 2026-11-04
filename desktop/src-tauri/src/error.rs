//! Static public failures: native diagnostics and local paths never enter errors.
use serde::Serialize;

#[derive(Debug, PartialEq)]
pub enum BackendError {
    Unavailable,
    Failed,
    Timeout,
    Empty,
    Malformed,
    Invalid,
    Request,
    #[cfg(feature = "synthetic-health-recovery")]
    WriteUncertain,
    Domain {
        code: &'static str,
        message: &'static str,
    },
}

#[derive(Clone, Copy)]
pub enum Service {
    Discovery,
    Save,
    Game,
    Player,
    Upgrade,
    Run,
    Items,
    Maps,
    Cosmetics,
}
impl Service {
    fn name(self) -> &'static str {
        match self {
            Self::Discovery => "discovery",
            Self::Save => "save",
            Self::Game => "game-status",
            Self::Player => "player",
            Self::Upgrade => "upgrades",
            Self::Run => "run",
            Self::Items => "advanced data",
            Self::Maps => "maps",
            Self::Cosmetics => "cosmetics",
        }
    }
}

#[derive(Serialize)]
pub struct PublicError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum Outcome<T> {
    Success { ok: bool, data: T },
    Failure { ok: bool, error: PublicError },
}
impl<T> From<Result<T, BackendError>> for Outcome<T> {
    fn from(value: Result<T, BackendError>) -> Self {
        Self::for_service(value, Service::Discovery)
    }
}
impl<T> Outcome<T> {
    pub fn for_service(value: Result<T, BackendError>, service: Service) -> Self {
        match value {
            Ok(data) => Self::Success { ok: true, data },
            Err(error) => {
                let name = service.name();
                let (code, message) = match error {
                    #[cfg(feature = "synthetic-health-recovery")]
                    BackendError::WriteUncertain => (
                        "write_uncertain",
                        "The write outcome requires explicit recovery before another write.".into(),
                    ),
                    BackendError::Unavailable => (
                        "python_unavailable",
                        format!("The Python {name} service is unavailable."),
                    ),
                    BackendError::Failed => (
                        "process_failed",
                        format!("The Python {name} service failed."),
                    ),
                    BackendError::Timeout => (
                        "process_timeout",
                        format!("The Python {name} service timed out."),
                    ),
                    BackendError::Empty => (
                        "empty_response",
                        format!("The Python {name} service returned no data."),
                    ),
                    BackendError::Malformed => (
                        "malformed_response",
                        format!("The Python {name} service returned malformed data."),
                    ),
                    BackendError::Invalid => (
                        "invalid_response",
                        format!("The Python {name} response did not match the desktop contract."),
                    ),
                    BackendError::Request => (
                        "invalid_request",
                        "A valid discovered save ID is required.".into(),
                    ),
                    BackendError::Domain { code, message } => (code, message.into()),
                };
                Self::Failure {
                    ok: false,
                    error: PublicError { code, message },
                }
            }
        }
    }
}

/// JSON framing shared by the narrowly typed native response validators.
pub fn json(bytes: &[u8]) -> Result<serde_json::Value, BackendError> {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Err(BackendError::Empty);
    }
    serde_json::from_slice(bytes).map_err(|_| BackendError::Malformed)
}
