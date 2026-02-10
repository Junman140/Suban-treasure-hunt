// ZK Treasure Hunt - Placement Proof Circuit
// Proves: "I placed exactly 5 treasures on valid grid positions with no overlaps"
// Public output: Pedersen commitment of board state (ZK-friendly, BN254 compatible)

use dep::std;

// 5 treasures as single cells (x, y) each
fn main(
    treasure0_x: u8,
    treasure0_y: u8,
    treasure1_x: u8,
    treasure1_y: u8,
    treasure2_x: u8,
    treasure2_y: u8,
    treasure3_x: u8,
    treasure3_y: u8,
    treasure4_x: u8,
    treasure4_y: u8,
) -> pub Field {
    // All coordinates in [0,9]
    std::assert(treasure0_x <= 9u8);
    std::assert(treasure0_y <= 9u8);
    std::assert(treasure1_x <= 9u8);
    std::assert(treasure1_y <= 9u8);
    std::assert(treasure2_x <= 9u8);
    std::assert(treasure2_y <= 9u8);
    std::assert(treasure3_x <= 9u8);
    std::assert(treasure3_y <= 9u8);
    std::assert(treasure4_x <= 9u8);
    std::assert(treasure4_y <= 9u8);

    // No overlaps: (ti_x, ti_y) != (tj_x, tj_y) for all i < j
    std::assert(pair_distinct(treasure0_x, treasure0_y, treasure1_x, treasure1_y));
    std::assert(pair_distinct(treasure0_x, treasure0_y, treasure2_x, treasure2_y));
    std::assert(pair_distinct(treasure0_x, treasure0_y, treasure3_x, treasure3_y));
    std::assert(pair_distinct(treasure0_x, treasure0_y, treasure4_x, treasure4_y));
    std::assert(pair_distinct(treasure1_x, treasure1_y, treasure2_x, treasure2_y));
    std::assert(pair_distinct(treasure1_x, treasure1_y, treasure3_x, treasure3_y));
    std::assert(pair_distinct(treasure1_x, treasure1_y, treasure4_x, treasure4_y));
    std::assert(pair_distinct(treasure2_x, treasure2_y, treasure3_x, treasure3_y));
    std::assert(pair_distinct(treasure2_x, treasure2_y, treasure4_x, treasure4_y));
    std::assert(pair_distinct(treasure3_x, treasure3_y, treasure4_x, treasure4_y));

    // Canonical encoding: (x, y) -> x + (y << 8) as Field for Pedersen commitment
    let f0 = std::scalar_to_field((treasure0_x as u64) + ((treasure0_y as u64) << 8));
    let f1 = std::scalar_to_field((treasure1_x as u64) + ((treasure1_y as u64) << 8));
    let f2 = std::scalar_to_field((treasure2_x as u64) + ((treasure2_y as u64) << 8));
    let f3 = std::scalar_to_field((treasure3_x as u64) + ((treasure3_y as u64) << 8));
    let f4 = std::scalar_to_field((treasure4_x as u64) + ((treasure4_y as u64) << 8));

    std::hash::pedersen_hash([f0, f1, f2, f3, f4])
}

fn pair_distinct(ax: u8, ay: u8, bx: u8, by: u8) -> bool {
    ax != bx || ay != by
}
