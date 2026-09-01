// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../../src/streaming/DripsStreaming.sol";
import {ManagedProxy} from "../../../src/streaming/Managed.sol";
import {IDrips} from "../../../src/streaming/IDrips.sol";
import {AddressDriver} from "../../../src/streaming/drivers/AddressDriver.sol";
import {Vault} from "../../../src/vault/Vault.sol";
import {VaultFactory} from "../../../src/vault/VaultFactory.sol";
import {Side} from "../../../src/vault/Side.sol";
import {BookmakerRegistry} from "../../../src/bookmaker/BookmakerRegistry.sol";
import {MarketRegistry} from "../../../src/market/MarketRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../../mocks/MockUSDC.sol";

/// @notice Proves the vault-aware AddressDriver: fund opens a real stream into a vault-side AND syncs
/// the Board in one call; stop refunds exactly the unspent; positions are per-account; the Vault
/// hooks are driver-gated.
contract AddressDriverTest is Test {
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

        vault.setStreaming(IDrips(address(drips)), IERC20(address(usdc)));

        uint32 addrDriverId = drips.registerDriver(address(this));
        AddressDriver driverLogic =
            new AddressDriver(IDrips(address(drips)), address(0), addrDriverId, vault, IERC20(address(usdc)));
        addressDriver = AddressDriver(address(new ManagedProxy(driverLogic, address(this), "")));
        drips.updateDriverAddress(addrDriverId, address(addressDriver));
        vault.setFundingDriver(address(addressDriver));

        bytes32 marketId = marketRegistry.registerMarket("market", bytes32("s"));
        v1 = vaultFactory.createVault(marketId, "Q1?");
    }

    function _fund(address who, bytes32 vaultId, Side side, uint256 rate, uint256 deposit) internal {
        usdc.mint(who, deposit);
        vm.startPrank(who);
        usdc.approve(address(addressDriver), deposit);
        addressDriver.fund(vaultId, side, rate, deposit);
        vm.stopPrank();
    }

    function test_fund_opensStreamAndSyncsBoard() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);

        (uint256 rate,,, uint32 maxEnd,) = vault.getPosition(v1, Side.Yes, alice);
        assertEq(rate, RATE, "board rate");
        assertEq(uint256(maxEnd), 150, "board maxEnd");

        (, uint256 sideRate,,) = vault.getBoard(v1, Side.Yes);
        assertEq(sideRate, RATE, "side rate");

        uint256 account = addressDriver.calcAccountId(alice);
        (,,,, uint32 dMaxEnd) = drips.streamsState(account, IERC20(address(usdc)));
        assertEq(uint256(dMaxEnd), 150, "real Drips stream opened");

        (,, uint256 ar, bool active,) = addressDriver.activeStream(account);
        assertTrue(active, "account active");
        assertEq(ar, RATE, "tracked rate");

        assertEq(usdc.balanceOf(address(drips)), 50 * RATE, "deposit custodied");
    }

    function test_stop_refundsUnspent() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);

        vm.warp(START + 20); // 20 USDC streamed, 30 unspent
        vm.prank(alice);
        addressDriver.stop();

        assertEq(usdc.balanceOf(alice), 30 * RATE, "refunded exactly the unspent");

        (uint256 rate,,,,) = vault.getPosition(v1, Side.Yes, alice);
        assertEq(rate, 0, "rate cleared");
        (, uint256 sideRate,,) = vault.getBoard(v1, Side.Yes);
        assertEq(sideRate, 0, "side rate dropped");

        assertGt(vault.pendingShares(v1, Side.Yes, alice), 0, "20s of shares banked");

        uint256 account = addressDriver.calcAccountId(alice);
        (,,, bool active,) = addressDriver.activeStream(account);
        assertFalse(active, "account freed");
    }

    function test_fund_revertsIfAccountAlreadyFunding() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE);

        usdc.mint(alice, 10 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(addressDriver), 10 * RATE);
        vm.expectRevert("AddressDriver: account already funding");
        addressDriver.fund(v1, Side.No, RATE, 10 * RATE);
        vm.stopPrank();
    }

    function test_stop_revertsIfNoPosition() public {
        vm.prank(alice);
        vm.expectRevert("AddressDriver: no active position");
        addressDriver.stop();
    }

    function test_vaultHooks_areDriverGated() public {
        vm.expectRevert("Vault: not funding driver");
        vault.onFund(alice, v1, Side.Yes, RATE, 150);

        vm.expectRevert("Vault: not funding driver");
        vault.receiverAccount(v1, Side.Yes);
    }

    /// Two separate accounts (the AA model) accrue independently in proportion to rate.
    function test_twoAccountsAccrueByRate() public {
        _fund(alice, v1, Side.Yes, RATE, 50 * RATE); // runs [100,150]
        _fund(bob, v1, Side.Yes, 2 * RATE, 100 * RATE); // runs [100,150]

        vm.warp(START + 50);
        vault.advance(v1, Side.Yes, 64);

        uint256 aShares = vault.pendingShares(v1, Side.Yes, alice);
        uint256 bShares = vault.pendingShares(v1, Side.Yes, bob);
        assertGt(aShares, 0, "alice nonzero");
        assertApproxEqAbs(bShares, 2 * aShares, 10, "bob streams 2x rate => 2x shares");
    }
}
