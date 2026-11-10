//! Writes sample mascot renders to `docs/gallery/` with the exact onchain renderer.
//! Run: `cargo run --example gallery`

use std::{fs, path::Path};

use molt::render::{render_svg, variant_names};
use molt::slots::{Genome, Slot};

const OUTPUT_DIR: &str = "../docs/gallery";

/// (file name, genome as background/shell/pattern/eyes/claws/headgear)
const SAMPLES: [(&str, [u8; 6]); 8] = [
    ("genesis", [0, 0, 0, 0, 0, 0]),
    ("chef", [5, 2, 1, 1, 0, 4]),
    ("fiddler", [1, 1, 5, 3, 3, 2]),
    ("laser-king", [6, 6, 4, 4, 1, 1]),
    ("ghost", [7, 3, 3, 5, 2, 3]),
    ("viking", [4, 7, 2, 2, 4, 5]),
    ("propeller", [2, 5, 0, 0, 1, 6]),
    ("grump", [3, 4, 1, 2, 0, 0]),
];

fn genome_from(values: [u8; 6]) -> Genome {
    let mut genome = Genome::default();
    for (slot, value) in Slot::ALL.into_iter().zip(values) {
        let count = variant_names(slot).len() as u8;
        assert!(value < count, "{slot:?} only has {count} variants");
        *genome.get_mut(slot) = value;
    }
    genome
}

fn main() -> std::io::Result<()> {
    let dir = Path::new(OUTPUT_DIR);
    fs::create_dir_all(dir)?;
    for (name, values) in SAMPLES {
        let svg = render_svg(&genome_from(values));
        let path = dir.join(format!("{name}.svg"));
        fs::write(&path, &svg)?;
        println!("{} ({} bytes)", path.display(), svg.len());
    }
    Ok(())
}
