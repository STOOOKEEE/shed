//! 60-cycle (60-day) simulation of $SHED supply under several community behaviours, using the
//! contract's own pricing functions. Deterministic (fixed seed).
//! Run: `cargo run --example simulate` — prints a markdown report and writes
//! `docs/simulation.svg`.

use std::fs;

use shed::pricing::{slot_price, split_winning_bid};

const CYCLES: u32 = 60;
const SLOTS: usize = 6;
const TOTAL_SUPPLY: f64 = 1_000_000_000.0;
const PRICE_GROWTH_BPS: u32 = 15_000;
const AUCTION_BURN_BPS: u32 = 5_000;
/// Base prices compared (whole SHED). The chart uses `CHOSEN_BASE_PRICE`.
const BASE_PRICES: [u128; 3] = [1_000, 10_000, 100_000];
const CHOSEN_BASE_PRICE: u128 = 10_000;
const CHART_PATH: &str = "../docs/simulation.svg";

/// xorshift64*: tiny deterministic PRNG, good enough for a behavioural model.
struct Rng(u64);

impl Rng {
    fn next_f64(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next_f64() * n as f64) as usize % n
    }
}

struct Scenario {
    name: &'static str,
    /// Active sculptors on a given cycle (1-based).
    sculptors: fn(u32) -> u32,
    transforms_per_sculptor: u32,
    /// Two whales fighting over the same slot every cycle, up to this price multiple.
    whale_war_multiple: Option<f64>,
}

const SCENARIOS: [Scenario; 4] = [
    Scenario {
        name: "Quiet (3 sculptors/day)",
        sculptors: |_| 3,
        transforms_per_sculptor: 2,
        whale_war_multiple: None,
    },
    Scenario {
        name: "Steady (25 sculptors/day)",
        sculptors: |_| 25,
        transforms_per_sculptor: 3,
        whale_war_multiple: None,
    },
    Scenario {
        name: "Hype then fade (200 → 10)",
        sculptors: |cycle| (10.0 + 190.0 * 0.5f64.powf(f64::from(cycle - 1) / 7.0)) as u32,
        transforms_per_sculptor: 3,
        whale_war_multiple: None,
    },
    Scenario {
        name: "Steady + whale war",
        sculptors: |_| 25,
        transforms_per_sculptor: 3,
        whale_war_multiple: Some(200.0),
    },
];

struct CycleOutcome {
    transform_burn: f64,
    auction_burn: f64,
}

/// One cycle: sculptors pick random slots and stop when the price exceeds what they are
/// willing to pay (base × 2..16, log-uniform). The skin then sells for 20–150 % of the cycle's
/// burn (no bid at all with fewer than 3 sculptors half of the time).
fn run_cycle(scenario: &Scenario, cycle: u32, base: u128, rng: &mut Rng) -> CycleOutcome {
    let mut changes = [0u32; SLOTS];
    let mut burn = 0u128;
    let sculptors = (scenario.sculptors)(cycle);
    for _ in 0..sculptors {
        let willingness = base as f64 * 2f64.powf(1.0 + 3.0 * rng.next_f64());
        for _ in 0..scenario.transforms_per_sculptor {
            let slot = rng.below(SLOTS);
            let price = slot_price(base, PRICE_GROWTH_BPS, changes[slot]).unwrap_or(u128::MAX);
            if price as f64 > willingness {
                continue;
            }
            changes[slot] += 1;
            burn += price;
        }
    }
    if let Some(multiple) = scenario.whale_war_multiple {
        let war_slot = rng.below(SLOTS);
        while let Some(price) = slot_price(base, PRICE_GROWTH_BPS, changes[war_slot]) {
            if price as f64 > base as f64 * multiple {
                break;
            }
            changes[war_slot] += 1;
            burn += price;
        }
    }
    let has_bid = burn > 0 && (sculptors >= 3 || rng.next_f64() < 0.5);
    let winning_bid = if has_bid {
        (burn as f64 * (0.2 + 1.3 * rng.next_f64())) as u128
    } else {
        0
    };
    let (auction_burn, _sculptor_pool) = split_winning_bid(winning_bid, AUCTION_BURN_BPS);
    CycleOutcome {
        transform_burn: burn as f64,
        auction_burn: auction_burn as f64,
    }
}

/// Supply at the end of every cycle (index 0 = launch).
fn simulate(scenario: &Scenario, base: u128) -> Vec<f64> {
    let mut rng = Rng(0x4D4F_4C54);
    let mut supply = vec![TOTAL_SUPPLY];
    for cycle in 1..=CYCLES {
        let outcome = run_cycle(scenario, cycle, base, &mut rng);
        let previous = *supply.last().unwrap_or(&TOTAL_SUPPLY);
        supply.push((previous - outcome.transform_burn - outcome.auction_burn).max(0.0));
    }
    supply
}

fn burned_percent(supply: &[f64], cycle: usize) -> f64 {
    100.0 * (1.0 - supply[cycle] / TOTAL_SUPPLY)
}

fn print_report() {
    println!("## Supply burned after {CYCLES} daily cycles (% of 1B)\n");
    print!("| Scenario |");
    for base in BASE_PRICES {
        print!(" base {base} SHED |");
    }
    println!("\n|---|{}", "---|".repeat(BASE_PRICES.len()));
    for scenario in &SCENARIOS {
        print!("| {} |", scenario.name);
        for base in BASE_PRICES {
            print!(
                " {:.2} % |",
                burned_percent(&simulate(scenario, base), CYCLES as usize)
            );
        }
        println!();
    }
    println!("\n## Chosen base price {CHOSEN_BASE_PRICE} SHED: burned % by day\n");
    println!("| Scenario | day 7 | day 14 | day 30 | day 60 |\n|---|---|---|---|---|");
    for scenario in &SCENARIOS {
        let supply = simulate(scenario, CHOSEN_BASE_PRICE);
        let at = |day: usize| format!("{:.2} %", burned_percent(&supply, day));
        println!(
            "| {} | {} | {} | {} | {} |",
            scenario.name,
            at(7),
            at(14),
            at(30),
            at(60)
        );
    }
}

fn chart_svg() -> String {
    const WIDTH: f64 = 640.0;
    const HEIGHT: f64 = 320.0;
    const MARGIN: f64 = 48.0;
    const COLORS: [&str; 4] = ["#36b6b0", "#3a86ff", "#ff6f61", "#f4c430"];
    let curves: Vec<Vec<f64>> = SCENARIOS
        .iter()
        .map(|s| simulate(s, CHOSEN_BASE_PRICE))
        .collect();
    let max_burn = curves
        .iter()
        .map(|c| burned_percent(c, CYCLES as usize))
        .fold(1.0, f64::max)
        .ceil();
    let x = |cycle: usize| MARGIN + (WIDTH - 2.0 * MARGIN) * cycle as f64 / f64::from(CYCLES);
    let y = |percent: f64| HEIGHT - MARGIN - (HEIGHT - 2.0 * MARGIN) * percent / max_burn;
    let mut svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" font-family="monospace" font-size="12"><rect width="{WIDTH}" height="{HEIGHT}" fill="#0b1a33"/><text x="{MARGIN}" y="24" fill="#fff">$SHED burned (% of supply), base price {CHOSEN_BASE_PRICE} SHED, ×1.5 per change</text><path d="M{MARGIN} {MARGIN}V{}H{}" stroke="#8aa" fill="none"/><text x="{MARGIN}" y="{}" fill="#8aa">day 0</text><text x="{}" y="{}" fill="#8aa" text-anchor="end">day {CYCLES}</text><text x="8" y="{}" fill="#8aa">{max_burn}%</text>"##,
        HEIGHT - MARGIN,
        WIDTH - MARGIN,
        HEIGHT - MARGIN + 16.0,
        WIDTH - MARGIN,
        HEIGHT - MARGIN + 16.0,
        MARGIN + 4.0,
    );
    for (index, (curve, scenario)) in curves.iter().zip(&SCENARIOS).enumerate() {
        let points: Vec<String> = (0..curve.len())
            .map(|cycle| format!("{:.1},{:.1}", x(cycle), y(burned_percent(curve, cycle))))
            .collect();
        let color = COLORS[index % COLORS.len()];
        svg.push_str(&format!(
            r##"<polyline points="{}" fill="none" stroke="{color}" stroke-width="2.5"/><text x="{}" y="{}" fill="{color}">{}</text>"##,
            points.join(" "),
            MARGIN + 12.0,
            MARGIN + 16.0 + 16.0 * index as f64,
            scenario.name
        ));
    }
    svg.push_str("</svg>");
    svg
}

fn main() -> std::io::Result<()> {
    print_report();
    fs::write(CHART_PATH, chart_svg())?;
    println!("\nChart written to {CHART_PATH}");
    Ok(())
}
