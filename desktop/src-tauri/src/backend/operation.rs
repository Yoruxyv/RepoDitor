//! Fixed sidecar arguments, services, request slots and deadlines.
use super::artwork;
use crate::error::Service;
#[cfg(feature = "health-transport")]
use std::time::Instant;
use std::{
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

pub(super) const DEADLINE: Duration = Duration::from_secs(30);
pub(super) const AVATAR_SLOT: usize = if cfg!(feature = "health-transport") {
    12
} else {
    9
};
pub(super) const ARTWORK_SLOT: usize = AVATAR_SLOT + 1;
pub(super) const OPERATIONS: usize = ARTWORK_SLOT + 1;

pub enum Operation {
    Discovery,
    Open(String, Option<String>, Arc<AtomicBool>),
    Entry(String, String, Arc<AtomicBool>),
    Game,
    Players(String),
    Avatar(String, String, Option<Arc<AtomicBool>>),
    Artwork(
        artwork::Scope,
        Option<String>,
        String,
        String,
        Arc<AtomicBool>,
    ),
    ArtworkBatch(Arc<artwork::ArtworkBatch>),
    Upgrades(String, Option<Arc<AtomicBool>>),
    Run(String),
    Items(String, Option<Arc<AtomicBool>>, bool),
    Maps(bool, Option<String>),
    Cosmetics(bool),
    #[cfg(feature = "production-health")]
    ProductionHealth(String, String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealth(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthBatch(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthBatchPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRefill(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRefillPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestUpgrades(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestUpgradesPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRun(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestRunPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMixed(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestMixedPrepare(String, String, String, String, Instant),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthRecover(String, String, bool, bool),
    #[cfg(feature = "synthetic-health-recovery")]
    TestHealthState(String),
    #[cfg(feature = "health-transport")]
    MetaState(bool, Option<String>),
    #[cfg(feature = "health-transport")]
    MetaPrepare(bool, u64, String, String, String, String, Instant),
    #[cfg(feature = "health-transport")]
    MetaWrite(bool, u64, String, String, String, String, Instant),
    #[cfg(feature = "health-transport")]
    MetaRecover(bool, String, String),
}
impl Operation {
    pub(super) fn slot(&self) -> usize {
        match self {
            #[cfg(feature = "production-health")]
            Self::ProductionHealth(action, ..) => match action.as_str() {
                "state" => 11,
                "inspect" | "acknowledge" => 10,
                _ => 9,
            },
            Self::Discovery => 0,
            Self::Open(..) => 1,
            Self::Game => 2,
            Self::Players(_) => 3,
            Self::Avatar(..) => AVATAR_SLOT,
            Self::Artwork(..) | Self::ArtworkBatch(_) => ARTWORK_SLOT,
            Self::Upgrades(..) | Self::Entry(..) => 4,
            Self::Run(_) => 5,
            Self::Items(..) => 6,
            Self::Maps(..) => 7,
            Self::Cosmetics(_) => 8,
            #[cfg(feature = "health-transport")]
            Self::MetaPrepare(..) | Self::MetaWrite(..) => 9,
            #[cfg(feature = "health-transport")]
            Self::MetaRecover(..) => 10,
            #[cfg(feature = "health-transport")]
            Self::MetaState(..) => 11,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealth(..)
            | Self::TestHealthPrepare(..)
            | Self::TestHealthBatch(..)
            | Self::TestHealthBatchPrepare(..)
            | Self::TestRefill(..)
            | Self::TestRefillPrepare(..)
            | Self::TestUpgrades(..)
            | Self::TestUpgradesPrepare(..)
            | Self::TestRun(..)
            | Self::TestRunPrepare(..)
            | Self::TestMixed(..)
            | Self::TestMixedPrepare(..) => 9,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthRecover(..) => 10,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthState(..) => 11,
        }
    }
    pub(super) fn deadline(&self) -> Duration {
        #[cfg(feature = "private-editing")]
        if let Self::ProductionHealth(action, _, _, _, payload, _) = self {
            if matches!(action.as_str(), "prepare" | "write" | "apply")
                && serde_json::from_str::<serde_json::Value>(payload).is_ok_and(|intent| {
                    intent.get("refillToFull").is_some()
                        || intent["mixed"]["refillToFull"]
                            .as_array()
                            .is_some_and(|items| !items.is_empty())
                })
            {
                // Preparing and publishing each scan the pinned Unity resources.
                return Duration::from_secs(120);
            }
        }
        DEADLINE
    }
    pub(super) fn service(&self) -> Service {
        match self {
            #[cfg(feature = "production-health")]
            Self::ProductionHealth(..) => Service::Save,
            Self::Discovery => Service::Discovery,
            Self::Open(..) | Self::Entry(..) => Service::Save,
            Self::Game => Service::Game,
            Self::Players(_) | Self::Avatar(..) => Service::Player,
            Self::Upgrades(..) | Self::Artwork(artwork::Scope::Upgrade, ..) => Service::Upgrade,
            Self::Run(_) => Service::Run,
            Self::Items(..) | Self::Artwork(artwork::Scope::Item, ..) => Service::Items,
            Self::Maps(..) | Self::Artwork(artwork::Scope::Map, ..) => Service::Maps,
            Self::Cosmetics(_) | Self::Artwork(artwork::Scope::Cosmetic, ..) => Service::Cosmetics,
            Self::ArtworkBatch(batch) if batch.scope == artwork::Scope::Upgrade => Service::Upgrade,
            Self::ArtworkBatch(batch) if batch.scope == artwork::Scope::Item => Service::Items,
            Self::ArtworkBatch(batch) if batch.scope == artwork::Scope::Map => Service::Maps,
            Self::ArtworkBatch(_) => Service::Cosmetics,
            #[cfg(feature = "health-transport")]
            Self::MetaState(..)
            | Self::MetaPrepare(..)
            | Self::MetaWrite(..)
            | Self::MetaRecover(..) => Service::Save,
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealth(..)
            | Self::TestHealthPrepare(..)
            | Self::TestHealthBatch(..)
            | Self::TestHealthBatchPrepare(..)
            | Self::TestRefill(..)
            | Self::TestRefillPrepare(..)
            | Self::TestUpgrades(..)
            | Self::TestUpgradesPrepare(..)
            | Self::TestRun(..)
            | Self::TestRunPrepare(..)
            | Self::TestMixed(..)
            | Self::TestMixedPrepare(..)
            | Self::TestHealthRecover(..)
            | Self::TestHealthState(..) => Service::Save,
        }
    }
    pub(super) fn arguments(&self) -> Vec<&str> {
        match self {
            #[cfg(feature = "production-health")]
            Self::ProductionHealth(action, save, operation, fingerprint, payload, _) => {
                vec![
                    "production-health",
                    action,
                    save,
                    operation,
                    fingerprint,
                    payload,
                ]
            }
            Self::Discovery => vec!["environment"],
            Self::Open(id, revision, _) => {
                let mut args = vec!["saves-open", id];
                if !cfg!(feature = "synthetic-health-recovery") {
                    args.push("--native");
                    if let Some(revision) = revision {
                        args.extend(["--entry-revision", revision]);
                    }
                }
                args
            }
            Self::Entry(id, fingerprint, _) => vec!["editor-entry", id, fingerprint],
            Self::Game => vec!["game-status"],
            Self::Players(id) => vec!["players-list", id],
            Self::Avatar(id, player, _) => vec!["players-avatar", id, player],
            Self::Artwork(scope, id, fingerprint, key, _) => {
                let mut args = vec![match scope {
                    artwork::Scope::Upgrade => "upgrade-artwork",
                    artwork::Scope::Item => "item-artwork",
                    artwork::Scope::Map => "map-artwork",
                    artwork::Scope::Cosmetic => "native-cosmetic-artwork",
                }];
                args.extend(id.as_deref());
                args.push(fingerprint);
                if *scope == artwork::Scope::Map {
                    args.push("--");
                }
                args.push(key);
                args
            }
            Self::ArtworkBatch(batch) => {
                if batch.scope == artwork::Scope::Map {
                    let mut args = vec!["map-artwork-batch", batch.fingerprint.as_str(), "--"];
                    args.extend(batch.members.iter().map(|member| member.key.as_str()));
                    return args;
                }
                if let Some(save) = &batch.save {
                    let mut args = vec![
                        if batch.scope == artwork::Scope::Item {
                            "item-artwork-batch"
                        } else {
                            "upgrade-artwork-batch"
                        },
                        save,
                        batch.fingerprint.as_str(),
                        "--",
                    ];
                    args.extend(batch.members.iter().map(|member| member.key.as_str()));
                    return args;
                }
                let mut args = vec!["native-cosmetic-artwork-batch", batch.fingerprint.as_str()];
                for member in &batch.members {
                    args.extend([
                        member.proof.as_deref().unwrap_or_default(),
                        member.key.as_str(),
                    ]);
                }
                args
            }
            Self::Upgrades(id, _) => vec!["upgrades-list", id, "--reuse-installed-metadata"],
            Self::Run(id) => vec!["run-get", id],
            Self::Items(id, ..) => vec!["advanced-get", id, "--reuse-installed-metadata"],
            Self::Maps(proof, save) => {
                let mut args = vec!["maps-list"];
                if *proof {
                    args.push("--entry-artwork-proof");
                }
                if let Some(save) = save {
                    args.extend(["--verify-save", save]);
                }
                args
            }
            Self::Cosmetics(true) => vec!["cosmetics-get", "--native-artwork", "--warm-artwork"],
            Self::Cosmetics(false) => vec!["cosmetics-get", "--native-artwork"],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealth(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--health-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthPrepare(id, fingerprint, payload, operation, _) => {
                let mut args = vec!["health-prepare", id, fingerprint, payload, operation];
                if cfg!(feature = "synthetic-health-ui") {
                    args.push("--intent");
                }
                args
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestUpgrades(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--upgrade-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthBatch(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--health-batch-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthBatchPrepare(id, fingerprint, payload, operation, _) => {
                vec!["health-batch-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRefill(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--refill-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRefillPrepare(id, fingerprint, payload, operation, _) => {
                vec!["refill-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestUpgradesPrepare(id, fingerprint, payload, operation, _) => {
                vec!["upgrade-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRun(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--run-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestRunPrepare(id, fingerprint, payload, operation, _) => {
                vec!["run-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMixed(id, fingerprint, payload, operation, _) => vec![
                "saves-write",
                id,
                fingerprint,
                payload,
                "--mixed-operation",
                operation,
            ],
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestMixedPrepare(id, fingerprint, payload, operation, _) => {
                vec!["mixed-prepare", id, fingerprint, payload, operation]
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthRecover(id, operation, canonical, acknowledge) => {
                let mut args = vec!["health-recover", id, operation];
                if *canonical {
                    args.push("--canonical");
                }
                if *acknowledge {
                    args.push("--acknowledge");
                }
                args
            }
            #[cfg(feature = "synthetic-health-recovery")]
            Self::TestHealthState(id) => vec!["health-state", id],
            #[cfg(feature = "health-transport")]
            Self::MetaState(production, operation) => {
                let mut args = vec![if *production {
                    "production-meta-state"
                } else {
                    "meta-state"
                }];
                if let Some(id) = operation {
                    args.push(id);
                }
                args
            }
            #[cfg(feature = "health-transport")]
            Self::MetaPrepare(production, _, id, fingerprint, intent, namespace, _) => {
                vec![
                    if *production {
                        "production-meta-prepare"
                    } else {
                        "meta-prepare"
                    },
                    id,
                    fingerprint,
                    intent,
                    namespace,
                ]
            }
            #[cfg(feature = "health-transport")]
            Self::MetaWrite(production, _, id, fingerprint, intent, namespace, _) => {
                vec![
                    if *production {
                        "production-meta-write"
                    } else {
                        "meta-write"
                    },
                    id,
                    fingerprint,
                    intent,
                    namespace,
                ]
            }
            #[cfg(feature = "health-transport")]
            Self::MetaRecover(production, id, proof) => vec![
                if *production {
                    "production-meta-recover"
                } else {
                    "meta-recover"
                },
                id,
                proof,
            ],
        }
    }
}
