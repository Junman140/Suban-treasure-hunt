// ZK Treasure Hunt - Hit/Miss Response Proof Circuit
// Proves: "Coordinate (x,y) hits/misses a treasure on my committed board" without revealing treasure positions
// Public inputs: target_x, target_y, hit_or_miss (1=hit, 0=miss), board_commitment (Field)
// Private: 5 treasure positions (must hash to commitment)

use dep::std;

fn main(
    // Public: target coordinate and claimed result
    target_x: pub u8,
    target_y: pub u8,
    hit_or_miss: pub u8,  // 1 = hit (treasure found), 0 = miss (empty)
    expected_commitment: pub Field,
    // Private: treasure positions (same encoding as placement circuit)
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
) {
    // Recompute commitment from private treasures
    let f0 = std::scalar_to_field((treasure0_x as u64) + ((treasure0_y as u64) << 8));
    let f1 = std::scalar_to_field((treasure1_x as u64) + ((treasure1_y as u64) << 8));
    let f2 = std::scalar_to_field((treasure2_x as u64) + ((treasure2_y as u64) << 8));
    let f3 = std::scalar_to_field((treasure3_x as u64) + ((treasure3_y as u64) << 8));
    let f4 = std::scalar_to_field((treasure4_x as u64) + ((treasure4_y as u64) << 8));
    let commitment = std::hash::pedersen_hash([f0, f1, f2, f3, f4]);
    std::assert(commitment == expected_commitment);

    // Check if (target_x, target_y) equals any treasure
    let is_hit = (target_x == treasure0_x && target_y == treasure0_y)
        || (target_x == treasure1_x && target_y == treasure1_y)
        || (target_x == treasure2_x && target_y == treasure2_y)
        || (target_x == treasure3_x && target_y == treasure3_y)
        || (target_x == treasure4_x && target_y == treasure4_y);

    // Constrain: if hit_or_miss==1 then is_hit must be true; if hit_or_miss==0 then is_hit must be false
    std::assert(hit_or_miss == 0u8 || hit_or_miss == 1u8);
    if hit_or_miss == 1u8 {
        std::assert(is_hit);
    } else {
        std::assert(!is_hit);
    }
}
