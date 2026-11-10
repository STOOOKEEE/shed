//! Pixel-art sprite sheets (32×32, one character per pixel, `.` = transparent), stored as
//! text in `sprites/*.txt` and compiled into the contract. A sheet is a list of sections:
//!
//! ```text
//! = Name [#rrggbb …]      header: variant name, optional colours
//! ................        0 or 32 rows of 32 characters
//! ```
//! Lines starting with `#` are comments.

pub const SIZE: usize = 32;
const TRANSPARENT: u8 = b'.';

const BACKGROUND_SHEET: &str = include_str!("sprites/background.txt");
const BODY_SHEET: &str = include_str!("sprites/body.txt");
const PATTERN_SHEET: &str = include_str!("sprites/pattern.txt");
const EYES_SHEET: &str = include_str!("sprites/eyes.txt");
const CLAWS_SHEET: &str = include_str!("sprites/claws.txt");
const HEADGEAR_SHEET: &str = include_str!("sprites/headgear.txt");

pub struct Sprite {
    pub name: String,
    /// `#rrggbb` tokens of the header (backgrounds: base then accent).
    pub colors: Vec<&'static str>,
    rows: Vec<&'static [u8]>,
}

impl Sprite {
    /// Palette letter at `(x, y)`, `None` if transparent or outside an empty sprite.
    pub fn pixel(&self, x: usize, y: usize) -> Option<u8> {
        let pixel = *self.rows.get(y)?.get(x)?;
        (pixel != TRANSPARENT).then_some(pixel)
    }
}

/// Parses a sheet. Malformed sheets are a build-time bug caught by the tests below.
pub fn parse(sheet: &'static str) -> Vec<Sprite> {
    let mut sprites: Vec<Sprite> = Vec::new();
    for line in sheet.lines() {
        if let Some(header) = line.strip_prefix("= ") {
            let (colors, words): (Vec<&str>, Vec<&str>) = header
                .split_whitespace()
                .partition(|token| token.starts_with('#'));
            sprites.push(Sprite {
                name: words.join(" "),
                colors,
                rows: Vec::new(),
            });
        } else if !line.is_empty()
            && !line.starts_with('#')
            && let Some(sprite) = sprites.last_mut()
        {
            sprite.rows.push(line.as_bytes());
        }
    }
    sprites
}

pub fn backgrounds() -> Vec<Sprite> {
    parse(BACKGROUND_SHEET)
}

pub fn body() -> Sprite {
    parse(BODY_SHEET).swap_remove(0)
}

pub fn patterns() -> Vec<Sprite> {
    parse(PATTERN_SHEET)
}

pub fn faces() -> Vec<Sprite> {
    parse(EYES_SHEET)
}

pub fn claws() -> Vec<Sprite> {
    parse(CLAWS_SHEET)
}

pub fn headgear() -> Vec<Sprite> {
    parse(HEADGEAR_SHEET)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_SHEETS: [&str; 6] = [
        BACKGROUND_SHEET,
        BODY_SHEET,
        PATTERN_SHEET,
        EYES_SHEET,
        CLAWS_SHEET,
        HEADGEAR_SHEET,
    ];

    #[test]
    fn every_sprite_is_empty_or_32_by_32() {
        for sheet in ALL_SHEETS {
            for sprite in parse(sheet) {
                assert!(
                    sprite.rows.is_empty() || sprite.rows.len() == SIZE,
                    "{} has {} rows",
                    sprite.name,
                    sprite.rows.len()
                );
                for row in &sprite.rows {
                    assert_eq!(
                        row.len(),
                        SIZE,
                        "{} has a row of {} pixels",
                        sprite.name,
                        row.len()
                    );
                }
            }
        }
    }

    #[test]
    fn sheets_hold_the_expected_variants() {
        let names = |sprites: Vec<Sprite>| sprites.into_iter().map(|s| s.name).collect::<Vec<_>>();
        assert_eq!(
            names(faces()),
            ["Round", "Sleepy", "Angry", "Googly", "Laser", "Dead"]
        );
        assert_eq!(names(claws()).len(), 5);
        assert_eq!(names(headgear())[0], "None");
        assert_eq!(names(patterns())[0], "Plain");
        assert_eq!(body().name, "Lobster");
    }

    #[test]
    fn backgrounds_declare_base_and_accent_colours() {
        let backgrounds = backgrounds();
        assert_eq!(backgrounds.len(), 8);
        for background in backgrounds {
            assert_eq!(background.colors.len(), 2, "{}", background.name);
        }
    }

    #[test]
    fn transparent_and_out_of_range_pixels_are_none() {
        let body = body();
        assert_eq!(body.pixel(0, 0), None);
        assert_eq!(body.pixel(SIZE, 0), None);
        assert_eq!(body.pixel(15, 15), Some(b'M'));
        assert_eq!(headgear()[0].pixel(15, 15), None);
    }
}
