//! The mascot's trait slots and per-slot containers.

use near_sdk::near;

use crate::render;

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
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
        u8::try_from(render::variant_names(self).len()).unwrap_or(u8::MAX)
    }
}

/// One value per slot. Serialized as `{ "background": .., "shell": .., ... }`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json::{self, json};

    #[test]
    fn slot_serializes_in_snake_case() {
        assert_eq!(
            serde_json::to_value(Slot::Headgear).unwrap(),
            json!("headgear")
        );
        let parsed: Slot = serde_json::from_value(json!("claws")).unwrap();
        assert_eq!(parsed, Slot::Claws);
    }

    #[test]
    fn genome_serializes_as_named_fields() {
        let mut genome = Genome::default();
        *genome.get_mut(Slot::Eyes) = 3;
        assert_eq!(
            serde_json::to_value(genome).unwrap(),
            json!({"background": 0, "shell": 0, "pattern": 0, "eyes": 3, "claws": 0, "headgear": 0})
        );
    }

    #[test]
    fn from_fn_fills_every_slot() {
        let per_slot = PerSlot::from_fn(|slot| slot as u8);
        for slot in Slot::ALL {
            assert_eq!(*per_slot.get(slot), slot as u8);
        }
    }

    #[test]
    fn every_slot_offers_several_variants() {
        for slot in Slot::ALL {
            assert!(slot.variant_count() >= 5, "{slot:?} has too few variants");
        }
    }
}
