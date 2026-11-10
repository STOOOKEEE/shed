//! Deterministic onchain pixel-art rendering of the mascot. The same function renders the live
//! mascot (views) and the frozen skins (NFT metadata), so what you see is what gets minted.
//!
//! Layers, back to front: background, body, pattern (only over body pixels), claws, headgear,
//! face. The 32×32 result becomes an SVG: one background rect, then one path per colour made
//! of 1-pixel-high horizontal strokes.

mod palette;
mod sprites;

use near_sdk::base64::{Engine, engine::general_purpose::STANDARD};

use crate::slots::{Genome, Slot};
use palette::SHELLS;
use sprites::{SIZE, Sprite};

/// Upper bound on a rendered SVG, keeps skin storage cost predictable.
pub const MAX_SVG_BYTES: usize = 4_096;
/// Body letters a pattern may paint over.
const BODY_LETTERS: &[u8] = b"MSL";

type Canvas = [[Option<&'static str>; SIZE]; SIZE];

/// Human-readable variant names of a slot, indexed by variant.
pub fn variant_names(slot: Slot) -> Vec<String> {
    let names = |sheet: Vec<Sprite>| sheet.into_iter().map(|sprite| sprite.name).collect();
    match slot {
        Slot::Background => names(sprites::backgrounds()),
        Slot::Shell => SHELLS.iter().map(|shell| shell.name.to_string()).collect(),
        Slot::Pattern => names(sprites::patterns()),
        Slot::Eyes => names(sprites::faces()),
        Slot::Claws => names(sprites::claws()),
        Slot::Headgear => names(sprites::headgear()),
    }
}

pub fn render_svg(genome: &Genome) -> String {
    let (base, canvas) = compose(genome);
    let mut paths: Vec<(&str, String)> = Vec::new();
    for (y, row) in canvas.iter().enumerate() {
        let mut x = 0;
        while x < SIZE {
            let Some(color) = row[x] else {
                x += 1;
                continue;
            };
            let start = x;
            while x < SIZE && row[x] == Some(color) {
                x += 1;
            }
            if color == base {
                continue;
            }
            let run = format!("M{start} {y}h{}", x - start);
            match paths
                .iter_mut()
                .find(|(path_color, _)| *path_color == color)
            {
                Some((_, data)) => data.push_str(&run),
                None => paths.push((color, run)),
            }
        }
    }
    // Strokes are centred on their path: the group shifts them half a pixel down so that a
    // run on row `y` covers exactly `[y, y + 1)`.
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" shape-rendering="crispEdges"><rect width="{SIZE}" height="{SIZE}" fill="{base}"/><g transform="translate(0 .5)">"#
    );
    for (color, data) in paths {
        svg.push_str(&format!(r#"<path stroke="{color}" d="{data}"/>"#));
    }
    svg.push_str("</g></svg>");
    svg
}

/// Stacks the layers of `genome`; returns the background base colour and the pixel colours.
fn compose(genome: &Genome) -> (&'static str, Canvas) {
    let background = pick(sprites::backgrounds(), genome.background);
    let background_colors = [background.colors[0], background.colors[1]];
    let shell = SHELLS.get(usize::from(genome.shell)).unwrap_or(&SHELLS[0]);
    let body = sprites::body();
    let pattern = pick(sprites::patterns(), genome.pattern);
    let front = [
        pick(sprites::claws(), genome.claws),
        pick(sprites::headgear(), genome.headgear),
        pick(sprites::faces(), genome.eyes),
    ];
    let mut canvas: Canvas = [[None; SIZE]; SIZE];
    for (y, row) in canvas.iter_mut().enumerate() {
        for (x, pixel) in row.iter_mut().enumerate() {
            let body_pixel = body.pixel(x, y);
            let mut letter = body_pixel.or(background.pixel(x, y));
            if body_pixel.is_some_and(|p| BODY_LETTERS.contains(&p)) {
                letter = pattern.pixel(x, y).or(letter);
            }
            for layer in &front {
                letter = layer.pixel(x, y).or(letter);
            }
            *pixel = letter.and_then(|l| palette::color(l, shell, background_colors));
        }
    }
    (background_colors[0], canvas)
}

/// Variant `index` of a sheet; an unknown index falls back to the first variant.
fn pick(mut sheet: Vec<Sprite>, index: u8) -> Sprite {
    let index = usize::from(index);
    sheet.swap_remove(if index < sheet.len() { index } else { 0 })
}

/// `data:` URI suitable for NEP-177 `media`.
pub fn svg_data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(slot: Slot, variant: u8) -> Genome {
        let mut genome = Genome::default();
        *genome.get_mut(slot) = variant;
        genome
    }

    fn max_genome() -> Genome {
        Genome::from_fn(|slot| variant_names(slot).len() as u8 - 1)
    }

    #[test]
    fn rendering_is_deterministic() {
        assert_eq!(render_svg(&max_genome()), render_svg(&max_genome()));
    }

    #[test]
    fn output_is_a_single_svg_document() {
        let svg = render_svg(&Genome::default());
        assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(svg.ends_with("</svg>"));
        assert_eq!(svg.matches("<svg").count(), 1);
    }

    #[test]
    fn every_variant_changes_the_picture() {
        for slot in Slot::ALL {
            let mut seen = Vec::new();
            for variant in 0..variant_names(slot).len() as u8 {
                let svg = render_svg(&with(slot, variant));
                assert!(
                    !seen.contains(&svg),
                    "{slot:?} variant {variant} looks like another one"
                );
                seen.push(svg);
            }
        }
    }

    /// Every shape combination (the shell only recolours, so one shell is enough).
    #[test]
    fn every_combination_fits_the_size_budget() {
        let count = |slot: Slot| variant_names(slot).len() as u8;
        let mut largest = 0;
        for background in 0..count(Slot::Background) {
            for pattern in 0..count(Slot::Pattern) {
                for eyes in 0..count(Slot::Eyes) {
                    for claws in 0..count(Slot::Claws) {
                        for headgear in 0..count(Slot::Headgear) {
                            let genome = Genome {
                                background,
                                shell: 0,
                                pattern,
                                eyes,
                                claws,
                                headgear,
                            };
                            largest = largest.max(render_svg(&genome).len());
                        }
                    }
                }
            }
        }
        assert!(
            largest <= MAX_SVG_BYTES,
            "largest skin renders {largest} bytes"
        );
    }

    #[test]
    fn data_uri_is_base64_svg() {
        let uri = svg_data_uri("<svg/>");
        assert_eq!(uri, "data:image/svg+xml;base64,PHN2Zy8+");
    }
}
