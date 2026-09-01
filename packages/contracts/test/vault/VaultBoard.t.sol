// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../src/streaming/DripsStreaming.sol";
import {ManagedProxy} from "../../src/streaming/Managed.sol";
import {IDrips} from "../../src/streaming/IDrips.sol";
import {AddressDriver} from "../../src/streaming/drivers/AddressDriver.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {Side} from "../../src/vault/Side.sol";
import {BookmakerRegistry} from "../../src/bookmaker/BookmakerRegistry.sol";
import {MarketRegistry} from "../../src/market/MarketRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Proves the streamed-funding Board now living on the Vault, driven by real Drips streams
/// opened through the vault-aware AddressDriver. Cycle-aligned timing (CYCLE 10, START 100, deposits
/// sized so maxEnds land on cycle boundaries) makes Drips' integer delivery equal the Board's
/// analytical pool exactly, so invariant I1 is asserted to the wei.
contract VaultBoardTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000; // 1 USDC/sec

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    VaultFactory internal vaultFactory;
    BookmakerRegistry internal bookmakerRegistry;
    MarketRegistry internal marketRegistry;
    AddressDriver internal addressDriver;

    bytes32 internal v1;
    bytes32 internal v2;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.warp(START);

        DripsStreaming logic = new DripsStreaming(CYCLE);
        drips = DripsStreaming(address(new ManagedProxy(logic, address(this), "")));
        usdc = new MockUSDC();

        bookmakerRegistry = new BookmakerRegistry(address(this));
        marketRegistry = new MarketRegistry(address(this));
        vault = new Vault();
        vaultFactory = new VaultFactory(bookmakerRegistry, marketRegistry, vault);
        vault.setFactory(address(vaultFactory));
        marketRegistry.setVaultFactory(address(vaultFactory));
        bookmakerRegistry.setBookmaker(address(this), true);

        // wire streaming: the Vault registers itself as the receiver driver (FD_vault)
        vault.setStreaming(IDrips(address(drips)), IERC20(address(usdc)));

        // deploy the vault-aware AddressDriver behind its proxy, registered as FD_user
        uint32 addrDriverId = drips.registerDriver(address(this));
        AddressDriver driverLogic =
            new AddressDriver(IDrips(address(drips)), address(0), addrDriverId, vault, IERC20(address(usdc)));
        addressDriver = AddressDriver(address(new ManagedProxy(driverLogic, address(this), "")));
        drips.updateDriverAddress(addrDriverId, address(addressDriver));
        vault.setFundingDriver(address(addressDriver));

        bytes32 marketId = marketRegistry.registerMarket("market", bytes32("s"));
        v1 = vaultFactory.createVault(marketId, "Q1?");
        v2 = vaultFactory.createVault(marketId, "Q2?");
    }

    function _fund(address who, bytes32 vaultId, Side side, uint256 rate, uint256 deposit) internal {
        usdc.mint(who, deposit);
        vm.startPrank(who);
        usdc.approve(address(addressDriver), deposit);
        addressDriver.fund(vaultId, side, rate, deposit);
        vm.stopPrank();
    }

    /// Single funder, $1/sec for 50s → ~498.75 shares (just under 500; the curve crept up).
    function test_accrual_singleFunderWorkedExample() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);

        vm.warp(START + 50);
        vault.advance(v1, Side.Yes, 64);

        uint256 shares = vault.pendingShares(v1, Side.Yes, alice);
        assertApproxEqAbs(shares, 498_750_000, 100_000, "~498.75 shares");
        assertLt(shares, 500_000_000, "strictly under 500");
    }

    /// I1: at depletion the pricing pool equals USDC actually delivered by Drips, to the wei.
    function test_depletion_pricingPoolEqualsDeliveredUSDC() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);

        (,,, uint32 maxEnd,) = vault.getPosition(v1, Side.Yes, alice);
        assertEq(uint256(maxEnd), 150, "run-dry at t=150");

        vm.warp(200);
        vault.advance(v1, Side.Yes, 64);

        (uint256 pool, uint256 sideRate,,) = vault.getBoard(v1, Side.Yes);
        assertEq(pool, 50 * RATE, "pool capped at consumed deposit");
        assertEq(sideRate, 0, "sideRate dropped at depletion");

        (,,,, bool depleted) = vault.getPosition(v1, Side.Yes, alice);
        assertTrue(depleted, "funder depleted");

        uint256 r = vault.receiverAccountView(v1, Side.Yes);
        uint128 delivered = drips.receiveStreams(r, IERC20(address(usdc)), type(uint32).max);
        assertEq(uint256(delivered), pool, "delivered == pool (I1)");
    }

    /// Fairness: Alice pokes every second, Bob never → identical shares (telescoping).
    function test_fairness_pokeFrequencyDoesNotChangeShares() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, v1, Side.Yes, RATE, 50 * RATE);

        for (uint256 t = START + 1; t <= 149; t++) {
            vm.warp(t);
            vault.settle(v1, Side.Yes, alice);
        }

        vm.warp(200);
        vault.advance(v1, Side.Yes, 64);

        (,, uint256 aShares,,) = vault.getPosition(v1, Side.Yes, alice);
        (,, uint256 bShares,,) = vault.getPosition(v1, Side.Yes, bob);
        assertGt(aShares, 0, "nonzero");
        assertEq(aShares, bShares, "poking must not change shares");
    }

    /// Independence: advancing one vault never touches another; identical inputs → identical Board.
    function test_independence_acrossVaults() public {
        _fund(alice, v1, Side.Yes, RATE, 100 * RATE);
        _fund(bob, v2, Side.Yes, RATE, 100 * RATE);

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

    /// Bounded advance: a 130-boundary backlog drains in 3 capped calls == one uncapped call.
    function test_boundedAdvance_chunkedEqualsUncappedAndNeverBricks() public {
        uint256 n = 130;
        for (uint256 i = 1; i <= n; i++) {
            uint256 deposit = RATE * 10 * i; // lasts 10*i sec → maxEnd = 100 + 10*i
            _fund(vm.addr(i + 1000), v1, Side.Yes, RATE, deposit);
            _fund(vm.addr(i + 5000), v1, Side.No, RATE, deposit);
        }

        vm.warp(100 + 10 * (n + 1)); // 1410, past the last run-dry

        uint256 calls;
        while (!vault.caughtUp(v1, Side.Yes)) {
            vault.advance(v1, Side.Yes, 64);
            calls++;
            assertLt(calls, 10, "must drain in a few bounded calls");
        }
        assertEq(calls, 3, "ceil(130/64) = 3 bounded calls");

        vault.advance(v1, Side.No, n + 1); // uncapped (one more than boundaries)
        assertTrue(vault.caughtUp(v1, Side.No), "uncapped caught up in one call");

        (uint256 poolY,, uint256 gY,) = vault.getBoard(v1, Side.Yes);
        (uint256 poolN,, uint256 gN,) = vault.getBoard(v1, Side.No);
        assertEq(gY, gN, "chunked board == uncapped board");
        assertEq(poolY, poolN, "chunked pool == uncapped pool");
        assertGt(gY, 0, "nonzero");
    }
}
