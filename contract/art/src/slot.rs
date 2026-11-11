//! Trait slots of the mascot, shared by the SHED and Exuviae renderers.

#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    borsh::BorshSerialize,
    borsh::BorshDeserialize,
    borsh::BorshSchema,
    serde::Serialize,
    serde::Deserialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Slot {
    Background,
    Shell,
    Pattern,
    Eyes,
    Claws,
    Headgear,
}

impl Slot {
    pub const ALL: [Slot; 6] = [
        Slot::Background,
        Slot::Shell,
        Slot::Pattern,
        Slot::Eyes,
        Slot::Claws,
        Slot::Headgear,
    ];

    /// Number of variants a slot accepts (variant indices are `0..count`).
    pub fn variant_count(self) -> u8 {
        u8::try_from(crate::variant_names(self).len()).unwrap_or(u8::MAX)
    }
}

/// One value per slot. Serialized as `{ "background": .., "shell": .., ... }`.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    borsh::BorshSerialize,
    borsh::BorshDeserialize,
    borsh::BorshSchema,
    serde::Serialize,
    serde::Deserialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub struct PerSlot<T> {
    pub background: T,
    pub shell: T,
    pub pattern: T,
    pub eyes: T,
    pub claws: T,
    pub headgear: T,
}

impl<T> PerSlot<T> {
    pub fn from_fn(mut f: impl FnMut(Slot) -> T) -> Self {
        Self {
            background: f(Slot::Background),
            shell: f(Slot::Shell),
            pattern: f(Slot::Pattern),
            eyes: f(Slot::Eyes),
            claws: f(Slot::Claws),
            headgear: f(Slot::Headgear),
        }
    }

    pub fn get(&self, slot: Slot) -> &T {
        match slot {
            Slot::Background => &self.background,
            Slot::Shell => &self.shell,
            Slot::Pattern => &self.pattern,
            Slot::Eyes => &self.eyes,
            Slot::Claws => &self.claws,
            Slot::Headgear => &self.headgear,
        }
    }

    pub fn get_mut(&mut self, slot: Slot) -> &mut T {
        match slot {
            Slot::Background => &mut self.background,
            Slot::Shell => &mut self.shell,
            Slot::Pattern => &mut self.pattern,
            Slot::Eyes => &mut self.eyes,
            Slot::Claws => &mut self.claws,
            Slot::Headgear => &mut self.headgear,
        }
    }
}

/// Variant index chosen for every slot.
pub type Genome = PerSlot<u8>;

