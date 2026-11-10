//! Colours. Shell letters (`K M S L`) are recoloured by the shell variant, background letters
//! (`B A`) come from the background sprite header, every other letter is fixed.

pub struct Shell {
    pub name: &'static str,
    pub main: &'static str,
    pub shade: &'static str,
    pub light: &'static str,
    pub outline: &'static str,
}

pub const SHELLS: [Shell; 8] = [
    Shell {
        name: "Lobster Red",
        main: "#e0403a",
        shade: "#a3242a",
        light: "#ff9e8a",
        outline: "#2a1016",
    },
    Shell {
        name: "Ocean Blue",
        main: "#3a7bd5",
        shade: "#24508f",
        light: "#8fc2ff",
        outline: "#0d1a33",
    },
    Shell {
        name: "Gold",
        main: "#f2b93b",
        shade: "#b9801c",
        light: "#fff0a8",
        outline: "#3b2508",
    },
    Shell {
        name: "Ghost",
        main: "#e9eef2",
        shade: "#a9b6c2",
        light: "#ffffff",
        outline: "#2b3440",
    },
    Shell {
        name: "Toxic Green",
        main: "#6fd34f",
        shade: "#3a8f2c",
        light: "#c8ff9a",
        outline: "#10280c",
    },
    Shell {
        name: "Royal Purple",
        main: "#8e4fc4",
        shade: "#5d2c8a",
        light: "#d2a6ff",
        outline: "#1d0d2e",
    },
    Shell {
        name: "Obsidian",
        main: "#34313f",
        shade: "#1f1d27",
        light: "#8b7fb8",
        outline: "#060509",
    },
    Shell {
        name: "Rust",
        main: "#c4622d",
        shade: "#8a3d17",
        light: "#f3a46b",
        outline: "#2a1206",
    },
];

/// Colours that never change: eyes, accessories, gloves, pattern accents.
const FIXED: [(u8, &str); 16] = [
    (b'W', "#fff6ec"), // eye white, chef hat
    (b'P', "#141014"), // pupil
    (b'Y', "#ffd23f"), // gold: crown, halo, stars
    (b'y', "#fff3b0"), // star glow
    (b'J', "#e8394d"), // jewel, pompom
    (b'C', "#2ec4b6"), // party hat, propeller
    (b'D', "#ff4f8b"), // party hat stripes, propeller blade
    (b'U', "#3a86ff"), // propeller cap
    (b'N', "#d9d9d9"), // chef hat band
    (b'O', "#f2e2bd"), // viking horns
    (b'I', "#8f9aa8"), // viking helmet
    (b'R', "#ff2a2a"), // laser
    (b'T', "#ff7aa2"), // tongue
    (b'g', "#d62828"), // boxing glove
    (b'h', "#ff8080"), // glove light
    (b'd', "#8f1414"), // glove shade
];

/// Colour of palette letter `letter`, given the shell and the background's `[base, accent]`.
pub fn color(letter: u8, shell: &Shell, background: [&'static str; 2]) -> Option<&'static str> {
    match letter {
        b'K' => Some(shell.outline),
        b'M' => Some(shell.main),
        b'S' => Some(shell.shade),
        b'L' => Some(shell.light),
        b'B' => Some(background[0]),
        b'A' => Some(background[1]),
        _ => FIXED
            .iter()
            .find(|(fixed, _)| *fixed == letter)
            .map(|(_, hex)| *hex),
    }
}
