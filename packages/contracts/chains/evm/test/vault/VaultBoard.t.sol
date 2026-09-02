// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../solidity/streaming/DripsStreaming.sol";
import {IDrips} from "../../solidity/streaming/IDrips.sol";
import {MarketDriver} from "../../solidity/streaming/drivers/MarketDriver.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";
import {MarketDriverHarness} from "../helpers/MarketDriverHarness.sol";
import {VaultDriverHarness} from "../helpers/VaultDriverHarness.sol";

/// @notice Proves the streamed-funding Board on the Vault, driven by MarketDriver Drips streams.
contract VaultBoardTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000;

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    MarketRegistry internal marketRegistry;
    MarketDriver internal marketDriver;
    VaultDriver internal vaultDriver;

    bytes32 internal marketId;
    bytes32 internal v1;
    bytes32 internal v2;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal aliceNft;
    uint256 internal bobNft;

    function setUp() public {
        vm.warp(START);

        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(address(this), IERC20(address(usdc)));
        marketRegistry = core.marketRegistry;
        vault = core.vault;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming);
        drips = streaming.drips;
        marketDriver = streaming.marketDriver;
        vaultDriver = core.vaultDriver;

        marketId = marketRegistry.registerMarket("market", bytes32("s"));
        v1 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q1?", Side.Yes);
        v2 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q2?", Side.No);

        aliceNft = MarketDriverHarness.mint(marketDriver, alice, marketId);
        bobNft = MarketDriverHarness.mint(marketDriver, bob, marketId);
    }

    function _fund(address who, uint256 tokenId, bytes32 vaultId, Side side, uint256 rate, uint256 deposit) internal {
        MarketDriverHarness.fund(marketDriver, usdc, who, tokenId, vaultId, side, rate, deposit);
    }

    function test_accrual_singleFunderWorkedExample() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        vm.warp(START + 50);
        vault.advance(v1, Side.Yes, 64);

        uint256 shares = vault.pendingShares(v1, Side.Yes, aliceNft);
        assertApproxEqAbs(shares, 498_750_000, 100_000, "~498.75 shares");
        assertLt(shares, 500_000_000, "strictly under 500");
    }

    function test_depletion_pricingPoolEqualsDeliveredUSDC() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);

        (,,, uint32 maxEnd,) = vault.getPosition(v1, Side.Yes, aliceNft);
        assertEq(uint256(maxEnd), 150, "run-dry at t=150");

        vm.warp(200);
        vault.advance(v1, Side.Yes, 64);

        (uint256 pool, uint256 sideRate,,) = vault.getBoard(v1, Side.Yes);
        assertEq(pool, 50 * RATE, "pool capped at consumed deposit");
        assertEq(sideRate, 0, "sideRate dropped at depletion");

        (,,,, bool depleted) = vault.getPosition(v1, Side.Yes, aliceNft);
        assertTrue(depleted, "funder depleted");

        uint256 r = vaultDriver.receiverAccountView(v1, Side.Yes);
        uint128 delivered = drips.receiveStreams(r, IERC20(address(usdc)), type(uint32).max);
        assertEq(uint256(delivered), pool, "delivered == pool (I1)");
    }

    function test_fairness_pokeFrequencyDoesNotChangeShares() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, v1, Side.Yes, RATE, 50 * RATE);

        for (uint256 t = START + 1; t <= 149; t++) {
            vm.warp(t);
            vault.settle(v1, Side.Yes, aliceNft);
        }

        vm.warp(200);
        vault.advance(v1, Side.Yes, 64);

        (,, uint256 aShares,,) = vault.getPosition(v1, Side.Yes, aliceNft);
        (,, uint256 bShares,,) = vault.getPosition(v1, Side.Yes, bobNft);
        assertGt(aShares, 0, "nonzero");
        assertEq(aShares, bShares, "poking must not change shares");
    }

    function test_independence_acrossVaults() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 100 * RATE);
        _fund(bob, bobNft, v2, Side.Yes, RATE, 100 * RATE);

        vm.warp(START + 40);
        vault.advance(v1, Side.Yes, 64);

        (uint256 pool1,, uint256 g1,) = vault.getBoard(v1, Side.Yes);
        (uint256 pool2,, uint256 g2, uint32 last2) = vault.getBoard(v2, Side.Yes);
        assertGt(g1, 0, "v1 advanced");
        assertEq(pool2, 0, "v2 untouched");
        assertEq(g2, 0, "v2 board untouched");
        assertEq(uint256(last2), START, "v2 still at funding time");

        vault.advance(v2, Side.Yes, 64);
        (uint256 pool2b,, uint256 g2b,) = vault.getBoard(v2, Side.Yes);
        assertEq(pool2b, pool1, "identical inputs => identical pool");
        assertEq(g2b, g1, "identical inputs => identical board");
    }

    function test_boundedAdvance_chunkedEqualsUncappedAndNeverBricks() public {
        uint256 n = 130;
        for (uint256 i = 1; i <= n; i++) {
            address whoY = vm.addr(i + 1000);
            address whoN = vm.addr(i + 5000);
            uint256 nftY = MarketDriverHarness.mint(marketDriver, whoY, marketId);
            uint256 nftN = MarketDriverHarness.mint(marketDriver, whoN, marketId);
            uint256 deposit = RATE * 10 * i;
            _fund(whoY, nftY, v1, Side.Yes, RATE, deposit);
            _fund(whoN, nftN, v1, Side.No, RATE, deposit);
        }

        vm.warp(100 + 10 * (n + 1));

        uint256 calls;
        while (!vault.caughtUp(v1, Side.Yes)) {
            vault.advance(v1, Side.Yes, 64);
            calls++;
            assertLt(calls, 10, "must drain in a few bounded calls");
        }
        assertEq(calls, 3, "ceil(130/64) = 3 bounded calls");

        vault.advance(v1, Side.No, n + 1);
        assertTrue(vault.caughtUp(v1, Side.No), "uncapped caught up in one call");

        (uint256 poolY,, uint256 gY,) = vault.getBoard(v1, Side.Yes);
        (uint256 poolN,, uint256 gN,) = vault.getBoard(v1, Side.No);
        assertEq(gY, gN, "chunked board == uncapped board");
        assertEq(poolY, poolN, "chunked pool == uncapped pool");
        assertGt(gY, 0, "nonzero");
    }
}
