// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StewardRegistry} from "../../solidity/steward/StewardRegistry.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";
import {VaultDriverHarness} from "../helpers/VaultDriverHarness.sol";

contract StewardRegistryTest is Test {
    StewardRegistry internal stewardRegistry;
    Vault internal vault;
    VaultDriver internal vaultDriver;
    MarketRegistry internal marketRegistry;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal stewardA = makeAddr("stewardA");
    address internal stewardB = makeAddr("stewardB");
    address internal stranger = makeAddr("stranger");

    bytes32 internal marketM;
    bytes32 internal vaultM;

    function setUp() public {
        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(owner, IERC20(address(usdc)));
        marketRegistry = core.marketRegistry;
        vault = core.vault;
        stewardRegistry = core.stewardRegistry;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(owner, vault, usdc, 10);
        streaming = ProtocolWire.wireAll(owner, core, streaming);
        vaultDriver = core.vaultDriver;

        vm.startPrank(owner);
        stewardRegistry.registerSteward(stewardA);
        stewardRegistry.registerSteward(stewardB);
        stewardRegistry.setDefaultSteward(stewardA);
        stewardRegistry.setDefaultSteward(stewardA);
        marketM = marketRegistry.registerMarket("M", bytes32("m"));
        stewardRegistry.setMarketSteward(marketM, stewardA);
        vm.stopPrank();

        vaultM = VaultDriverHarness.bondVault(vaultDriver, usdc, marketM, "Q?", Side.Yes);
    }

    function test_assignedStewardResolves() public {
        vm.prank(stewardA);
        stewardRegistry.resolveVault(vaultM, Vault.Outcome.Yes);
        assertEq(uint8(vault.getVault(vaultM).status), uint8(Vault.Status.Resolved));
    }

    function test_otherRegisteredStewardCannotResolve() public {
        vm.prank(stewardB);
        vm.expectRevert("StewardRegistry: not market steward");
        stewardRegistry.resolveVault(vaultM, Vault.Outcome.Yes);
    }

    function test_defaultStewardResolvesUnassignedMarket() public {
        bytes32 marketU = marketRegistry.registerMarket("U", bytes32("u"));
        bytes32 vaultU = VaultDriverHarness.bondVault(vaultDriver, usdc, marketU, "Q2?", Side.No);

        vm.prank(stewardA);
        stewardRegistry.resolveVault(vaultU, Vault.Outcome.No);
        assertEq(uint8(vault.getVault(vaultU).status), uint8(Vault.Status.Resolved));
    }

    function test_ownerReassignsMarketSteward() public {
        vm.prank(owner);
        stewardRegistry.setMarketSteward(marketM, stewardB);

        vm.prank(stewardA);
        vm.expectRevert("StewardRegistry: not market steward");
        stewardRegistry.resolveVault(vaultM, Vault.Outcome.Yes);

        vm.prank(stewardB);
        stewardRegistry.resolveVault(vaultM, Vault.Outcome.Yes);
    }

    function test_vaultResolveStillOnlyResolver() public {
        vm.prank(stranger);
        vm.expectRevert("Vault: not resolver");
        vault.resolve(vaultM, Vault.Outcome.Yes);
    }

    function test_hotGatedToMarketSteward() public {
        vm.prank(stewardB);
        vm.expectRevert("StewardRegistry: not market steward");
        stewardRegistry.triggerHot(vaultM, StewardRegistry.Severity.Hot, block.timestamp + 1 hours, bytes32("r"));

        vm.prank(stewardA);
        stewardRegistry.triggerHot(vaultM, StewardRegistry.Severity.Hot, block.timestamp + 1 hours, bytes32("r"));
        (bool active,,,) = stewardRegistry.vaultHotState(vaultM);
        assertTrue(active);
    }

    function test_setMarketSteward_requiresRegistration() public {
        vm.prank(owner);
        vm.expectRevert("StewardRegistry: unregistered steward");
        stewardRegistry.setMarketSteward(marketM, stranger);
    }
}
