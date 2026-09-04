// SPDX-License-Identifier: GPL-3.0-only

module livestreak::side;

const SIDE_YES: u8 = 0;
const SIDE_NO: u8 = 1;

const E_INVALID_SIDE: u64 = 1;

public fun yes(): u8 {
    SIDE_YES
}

public fun no(): u8 {
    SIDE_NO
}

public fun assert_valid(side: u8) {
    assert!(side == SIDE_YES || side == SIDE_NO, E_INVALID_SIDE);
}

public fun is_yes(side: u8): bool {
    side == SIDE_YES
}
